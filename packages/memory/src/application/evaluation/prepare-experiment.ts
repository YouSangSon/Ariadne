import { chunkText } from "../../domain/policies/chunk-text.js";
import type { EvaluationCorpusSource } from "./ports.js";
import type { ClientAbExperiment, Fixture, PreparedClientRecord, PreparedClientTask } from "./client-policy.js";
import { FOREIGN_SENTINEL_MARKERS, FULL_SHA, SHARED_PROMPT_SUFFIX, TASK_SEED_REQUIREMENTS, assertContextSelection, makeRecord, normalize, parseFixture, parseSeeds, text } from "./client-policy.js";

function documentRecords(sources: EvaluationCorpusSource, sha: string, fixture: Fixture): PreparedClientRecord[] {
  const records: PreparedClientRecord[] = [];
  for (const sourcePath of fixture.sourcePaths) {
    const chunks = chunkText({ text: sources.readAtRevision(sha, sourcePath), ...fixture.chunking });
    if (chunks.length === 0) throw new Error(`client A/B tracked source ${sourcePath} produced no chunks`);
    for (const chunk of chunks) {
      records.push(makeRecord({
        id: `doc:${sourcePath}:${chunk.chunkIndex}`, scope: "project", kind: "fact", content: chunk.content,
        sourceRef: `${sourcePath}#chunk-${chunk.chunkIndex}`, organizationId: fixture.organizationId,
      }, fixture.chunking));
    }
  }
  return records;
}
function seedRecords(sources: EvaluationCorpusSource, sha: string, fixture: Fixture): PreparedClientRecord[] {
  return parseSeeds(sources.readAtRevision(sha, fixture.seedSourcePath)).map((entry) => makeRecord({
    id: `seed:${entry.seedKey}`, seedKey: entry.seedKey, scope: entry.scope, kind: entry.kind, content: entry.content,
    sourceRef: fixture.seedSourcePath, organizationId: fixture.organizationId,
  }, fixture.chunking));
}

export function prepareClientAbExperiment(input: { repoDir: string; sha: string; fixturePath: string }, sources: EvaluationCorpusSource): ClientAbExperiment {
  text(input.repoDir, "repoDir");
  if (!FULL_SHA.test(input.sha)) throw new Error("client A/B evaluation SHA must be a full lowercase 40-character SHA");
  if (sources.headSha().trim() !== input.sha) throw new Error("client A/B evaluation SHA must match HEAD exactly");
  if (sources.hasTrackedChanges()) throw new Error("client A/B evaluation refuses tracked staged or unstaged changes");
  let fixtureValue: unknown;
  try { fixtureValue = JSON.parse(sources.readAtRevision(input.sha, input.fixturePath)); } catch (_error: unknown) { throw new Error("client A/B fixture must be valid JSON at the pinned SHA"); }
  const fixture = parseFixture(fixtureValue);
  const targetRecords = [...documentRecords(sources, input.sha, fixture), ...seedRecords(sources, input.sha, fixture)];
  const rawTokenCount = targetRecords.reduce((sum, record) => sum + (record.content.match(/\S+/g)?.length ?? 0), 0);
  if (rawTokenCount > fixture.rawCorpusTokenCap) throw new Error(`client A/B corpus exceeds its versioned ${fixture.rawCorpusTokenCap}-token cap`);
  const rawCanonicalContext = targetRecords.map((record) => record.content).join("\n\n");
  if (FOREIGN_SENTINEL_MARKERS.some((marker) => normalize(rawCanonicalContext).includes(marker))) throw new Error("client A/B foreign sentinel leaked into the target canonical context");
  const bySeed = new Map(targetRecords.flatMap((record) => record.seedKey === undefined ? [] : [[record.seedKey, record] as const]));
  const tasks = fixture.tasks.map((task): PreparedClientTask => {
    const contextRecords = TASK_SEED_REQUIREMENTS[task.id]!.map((key) => {
      const record = bySeed.get(key);
      if (record === undefined) throw new Error(`client A/B task ${task.id} is missing required tracked seed ${key}`);
      return record;
    });
    assertContextSelection(task, contextRecords, targetRecords);
    return { ...task, contextRecords };
  });
  const foreignRecord = makeRecord({
    id: fixture.foreignSentinel.id, scope: "project", kind: "fact", content: fixture.foreignSentinel.content,
    sourceRef: "foreign-sentinel", organizationId: fixture.foreignOrganizationId,
  }, fixture.chunking);
  return {
    sourceSha: input.sha, corpusVersion: fixture.corpusVersion, organizationId: fixture.organizationId,
    foreignOrganizationId: fixture.foreignOrganizationId, projectKey: fixture.projectKey, userScopeId: fixture.userScopeId,
    targetRecords, seedRecords: [...targetRecords, foreignRecord], tasks, rawCanonicalContext, sharedPromptSuffix: SHARED_PROMPT_SUFFIX,
  };
}