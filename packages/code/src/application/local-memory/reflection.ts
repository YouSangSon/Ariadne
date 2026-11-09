import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";
import { DEFAULT_OLDER_THAN_DAYS, MIN_FACTS_PER_ENTITY, REFLECTION_ATTRIBUTE, SYSTEM_PROMPT, renderUserPrompt } from "../../domain/local-memory/reflection.js";
import type { ReflectOptions, ReflectResult, ReflectionDraft } from "../../domain/local-memory/reflection.js";
import type { ReflectionResult } from "../../domain/local-memory/summarizer.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import type { ReflectionPorts } from "./reflection-ports.js";

export async function reflectFacts(
  repoRoot: string,
  options: ReflectOptions,
  ports: ReflectionPorts
): Promise<ReflectResult> {
  const branchName = options.branch ?? 'main';
  const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const factCap = ports.maxFactsPerEntity();
  const collected = ports.repository.candidates(repoRoot, branchName, cutoff, options.entity, factCap);

  if (collected.size === 0) {
    return { branch: branchName, model: 'none', summarized: 0, skippedEntities: 0, reflections: [] };
  }

  let skippedEntities = 0;
  const drafts: ReflectionDraft[] = [];
  for (const [entity, candidates] of collected) {
    if (candidates.totalCount < MIN_FACTS_PER_ENTITY) {
      skippedEntities += 1;
      continue;
    }
    const userPrompt = renderUserPrompt(entity, candidates);
    let summaryResult: ReflectionResult;
    try {
      summaryResult = await ports.summarize({ systemPrompt: SYSTEM_PROMPT, userPrompt });
    } catch (error: unknown) {
      throw new Error(
        `summarize failed for ${entity}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const safeSummary = redactSecrets(summaryResult.summary).trim();
    if (!safeSummary) {
      skippedEntities += 1;
      continue;
    }
    let embedding: EmbeddingResult | null = null;
    if (!options.dryRun) {
      try {
        embedding = await ports.embed(
          `${entity}|${REFLECTION_ATTRIBUTE}|${JSON.stringify(safeSummary)}`
        );
      } catch (error: unknown) {
        throw new Error(
          `embedding failed for ${entity}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    drafts.push({
      entity,
      sourceFactIds: candidates.facts.map((row) => row.id),
      summary: safeSummary,
      model: summaryResult.model,
      embedding
    });
  }

  if (drafts.length === 0) {
    return {
      branch: branchName,
      model: 'none',
      summarized: 0,
      skippedEntities,
      reflections: []
    };
  }

  if (options.dryRun) {
    return {
      branch: branchName,
      model: drafts[0]?.model ?? 'none',
      summarized: drafts.length,
      skippedEntities,
      reflections: drafts.map((draft) => ({
        entity: draft.entity,
        summaryFactId: '<dry-run>',
        sourceCount: draft.sourceFactIds.length
      }))
    };
  }

  const written = ports.repository.persist(repoRoot, branchName, drafts, options.agent, olderThanDays);

  return {
    branch: branchName,
    model: drafts[0]?.model ?? 'unknown',
    summarized: written.length,
    skippedEntities,
    reflections: written
  };
}
