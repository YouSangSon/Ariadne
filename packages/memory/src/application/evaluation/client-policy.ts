import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertObservedPackBudget, measureToolPayloadBytes, type ToolPayloadBytes } from "../../domain/evaluation/payload-metrics.js";
import { chunkText } from "../../domain/policies/chunk-text.js";
import type { ToolRegistry } from "../contracts/tools.js";


export const FULL_SHA = /^[0-9a-f]{40}$/;
export const SAFE_SOURCE_PATHS = [
  "CONTEXT.md", "CONTRACTS.md", "CONTRIBUTING.md", "DECISIONS.md", "DESIGN.md",
  "README.md", "SECURITY.md", "docs/CODEX-NAVIGATION-GUIDE.md", "docs/README.md",
  "docs/api-reference.md", "docs/architecture.md", "docs/deployment.md",
  "docs/migrations/openai-to-transformers.md", "docs/operations.md", "docs/troubleshooting.md",
] as const;
export const FOREIGN_SENTINEL_MARKERS = ["orbital_sentinel_9bce"] as const;
export const SHARED_PROMPT_SUFFIX = "Return exactly one JSON object matching the supplied schema. The claims object must contain exactly the requested claim keys and string values.";
export const ANSWER_KEYS: Readonly<Record<string, { alternatives: readonly string[]; required: readonly string[]; contradictions: readonly string[] }>> = {
  canonical_store: { alternatives: ["postgres", "postgresql"], required: [], contradictions: ["qdrant is canonical", "qdrant is the canonical"] },
  vector_recovery: { alternatives: ["rebuild", "rebuilt", "reindex"], required: [], contradictions: ["cannot be rebuilt"] },
  default_language: { alternatives: ["korean", "한국어"], required: [], contradictions: ["english by default", "english is the default"] },
  logging_rule: { alternatives: ["never log", "do not log"], required: [], contradictions: ["raw memory content may be logged"] },
  source_diversity: { alternatives: ["source diversity"], required: [], contradictions: ["one noisy document may crowd out"] },
  chunk_policy: { alternatives: ["800 tokens"], required: ["120-token overlap"], contradictions: ["no overlap"] },
};
export const ANSWER_CHOICES: Readonly<Record<string, { expected: string; choices: string[] }>> = {
  canonical_store: { expected: "postgres", choices: ["filesystem", "postgres", "qdrant"] },
  vector_recovery: { expected: "rebuild_from_postgres", choices: ["discard_memory", "rebuild_from_postgres", "restore_vectors_only"] },
  default_language: { expected: "korean", choices: ["english", "japanese", "korean"] },
  logging_rule: { expected: "never_log_raw_memory_content", choices: ["log_full_content", "never_log_raw_memory_content", "redact_after_logging"] },
  source_diversity: { expected: "preserve_source_diversity", choices: ["one_source_only", "preserve_source_diversity", "unrestricted_source_dominance"] },
  chunk_policy: { expected: "800_tokens_120_overlap", choices: ["320_tokens_no_overlap", "800_tokens_120_overlap", "800_tokens_no_overlap"] },
};
export const TASK_SEED_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
  "canonical-state": ["alpha.canonical-pg"],
  "operator-preferences": ["alice.korean-default", "alpha.no-content-logging"],
  "context-quality": ["alpha.context-pack-diversity", "alpha.chunk-size"],
};

export type ClientVendor = "codex" | "claude";
export type ClientCondition = "off" | "on";
export type ClientAbProfile = "mcp-roundtrip" | "cli-prefetch";
export type ClientPrefetchPack = {
  packMarkdown: string;
  receipt: { contextPackRunId: string; selectedMemoryIds: string[]; packSha256: string; cliDurationMs: number };
};
export type FixtureTask = { id: string; task: string; claimKeys: string[] };
export type Fixture = {
  version: number; corpusVersion: number; organizationId: string; foreignOrganizationId: string;
  projectKey: string; userScopeId: string; rawCorpusTokenCap: number; sourcePaths: string[];
  seedSourcePath: string; chunking: { targetTokens: number; overlapTokens: number };
  foreignSentinel: { id: string; content: string }; tasks: FixtureTask[];
};
export type PreparedClientRecord = {
  id: string; scope: "project" | "user"; kind: "decision" | "fact" | "summary"; content: string; sourceRef: string; organizationId: string;
  chunks: readonly string[]; seedKey?: string;
};
export type PreparedClientTask = FixtureTask & { contextRecords: readonly PreparedClientRecord[] };
export type ClientAbExperiment = {
  sourceSha: string; corpusVersion: number; organizationId: string; foreignOrganizationId: string;
  projectKey: string; userScopeId: string; targetRecords: readonly PreparedClientRecord[];
  seedRecords: readonly PreparedClientRecord[]; tasks: readonly PreparedClientTask[];
  rawCanonicalContext: string; sharedPromptSuffix: string;
};
export type ToolCall = { server: string; name: string; arguments?: unknown; succeeded?: boolean; selectedMemoryIds?: string[]; payloadBytes?: ToolPayloadBytes };
export type ClientUsage = { inputTokens: number; cachedInputTokens: number; toolCalls: ToolCall[] };
export type ClaudeStreamResult = ClientUsage & { structuredOutput: unknown; observedModel: string };
export type ClientWorkspace = { rootDir: string; cwd: string; schemaPath: string };
export type ClientPair = {
  vendor: ClientVendor; taskId: string; repeat: number;
  off: { success: boolean; inputTokens: number }; on: { success: boolean; inputTokens: number };
};
export type ClientPairSummary = {
  vendor: ClientVendor; pairCount: number; allPairsSuccessful: boolean;
  medianInputTokenReduction: number; passed: boolean;
};
export type ClientAbRegistry = Pick<ToolRegistry, "add_memory" | "build_context_pack">;
export type ClientAbPreflightTask = {
  taskId: string; selectedMemoryIds: string[]; requiredMemoryIds: string[];
  rawInputWordEstimate: number; contextPackWordEstimate: number; foreignLeakageCount: number;
  rawCanonicalUtf8Bytes?: number; contextPackMarkdownUtf8Bytes?: number; contextPackStructuredJsonUtf8Bytes?: number;
};
export type ClientAbPreflight = {
  sourceSha: string; corpusVersion: number; seededRecordCount: number;
  rawCanonicalWordEstimate: number; foreignLeakageCount: number; allowedMemoryIds: string[];
  tasks: ClientAbPreflightTask[];
  maxOutputBytes?: number;
};
export type ClientConditionResult = {
  profile: ClientAbProfile;
  vendor: ClientVendor; taskId: string; repeat: number; condition: ClientCondition;
  runIndex: number; success: boolean; inputTokens: number; cachedInputTokens: number;
  toolCalls: ToolCall[]; grade: ReturnType<typeof gradeClientAnswer>;
  model: { requested: string; observed: string | null }; cliVersion: string;
  clientStdinUtf8Bytes?: number; clientDurationMs?: number;
  maxOutputBytes?: number;
};
export type ClientAbRunSummary = {
  profile: ClientAbProfile;
  vendor: ClientVendor; sourceSha: string; corpusVersion: number; cliVersion: string;
  model: { requested: string; observed: string | null }; pairs: ClientPair[];
  aggregate: ClientPairSummary;
  maxOutputBytes?: number;
  totals: { offInputTokens: number; onInputTokens: number; offCachedInputTokens: number; onCachedInputTokens: number };
};
export type ClientExecutor = (command: ClientCommand) => Promise<{ stdout: string; stderr: string; finalOutput?: string }>;
export type ClientAbRunInput = {
  profile?: ClientAbProfile; prefetch?: (task: PreparedClientTask) => Promise<ClientPrefetchPack>;
  experiment: ClientAbExperiment; vendor: ClientVendor; model: string; resultDir: string;
  mcpServer: LiveMcpServer; executePaid: boolean; allowedMemoryIds: readonly string[]; env?: Record<string, string | undefined>;
  effort?: string; maxBudgetUsd?: number; executeSubscription?: boolean;
  maxOutputBytes?: number;
  readSubscriptionStatus?: () => Promise<CodexSubscriptionStatus>;
  execute?: ClientExecutor; getCliVersion?: (binary: string) => Promise<string>;
};

export function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
}
export function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-blank string`);
}
export function positive(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}
export function nonNegative(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}
export function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}
export function trackedPath(value: string, name: string): void {
  text(value, name);
  if (path.posix.isAbsolute(value) || value.split("/").includes("..")) throw new Error(`${name} must be a tracked relative path`);
}

export function parseFixture(value: unknown): Fixture {
  object(value, "client A/B fixture");
  const names = ["organizationId", "foreignOrganizationId", "projectKey", "userScopeId", "seedSourcePath"] as const;
  const scalars = {} as Record<(typeof names)[number], string>;
  for (const name of names) {
    const candidate = value[name];
    text(candidate, `client A/B fixture ${name}`);
    scalars[name] = candidate;
  }
  trackedPath(scalars.seedSourcePath, "client A/B fixture seedSourcePath");
  positive(value.version, "client A/B fixture version");
  positive(value.corpusVersion, "client A/B fixture corpusVersion");
  positive(value.rawCorpusTokenCap, "client A/B fixture rawCorpusTokenCap");
  object(value.chunking, "client A/B fixture chunking");
  positive(value.chunking.targetTokens, "client A/B fixture chunking.targetTokens");
  nonNegative(value.chunking.overlapTokens, "client A/B fixture chunking.overlapTokens");
  if (value.chunking.overlapTokens >= value.chunking.targetTokens) throw new Error("client A/B fixture overlapTokens must be smaller than targetTokens");
  if (!Array.isArray(value.sourcePaths) || !value.sourcePaths.every((item) => typeof item === "string") || value.sourcePaths.join("\n") !== [...SAFE_SOURCE_PATHS].join("\n")) {
    throw new Error("client A/B fixture sourcePaths must equal the sorted safe source allowlist");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length !== 3) throw new Error("client A/B fixture must define exactly three tasks");
  object(value.foreignSentinel, "client A/B fixture foreignSentinel");
  const foreignId = value.foreignSentinel.id;
  const foreignContent = value.foreignSentinel.content;
  text(foreignId, "client A/B fixture foreignSentinel.id");
  text(foreignContent, "client A/B fixture foreignSentinel.content");
  const ids = new Set<string>();
  const tasks = value.tasks.map((candidate, index): FixtureTask => {
    object(candidate, `client A/B fixture tasks[${index}]`);
    const id = candidate.id;
    const task = candidate.task;
    text(id, `client A/B fixture tasks[${index}].id`);
    text(task, `client A/B fixture tasks[${index}].task`);
    if (ids.has(id) || TASK_SEED_REQUIREMENTS[id] === undefined) throw new Error(`client A/B fixture tasks[${index}] must use a unique supported task id`);
    ids.add(id);
    if (!Array.isArray(candidate.claimKeys) || candidate.claimKeys.length === 0 || !candidate.claimKeys.every((key) => typeof key === "string" && key.trim()) || new Set(candidate.claimKeys).size !== candidate.claimKeys.length || candidate.claimKeys.some((key) => ANSWER_KEYS[key] === undefined)) {
      throw new Error(`client A/B fixture tasks[${index}] has unsupported or repeated claim keys`);
    }
    return { id, task, claimKeys: [...candidate.claimKeys] };
  });
  if (ids.size !== Object.keys(TASK_SEED_REQUIREMENTS).length) throw new Error("client A/B fixture must cover every fixed task");
  return {
    version: value.version, corpusVersion: value.corpusVersion, organizationId: scalars.organizationId,
    foreignOrganizationId: scalars.foreignOrganizationId, projectKey: scalars.projectKey, userScopeId: scalars.userScopeId,
    rawCorpusTokenCap: value.rawCorpusTokenCap, sourcePaths: [...value.sourcePaths], seedSourcePath: scalars.seedSourcePath,
    chunking: { targetTokens: value.chunking.targetTokens, overlapTokens: value.chunking.overlapTokens },
    foreignSentinel: { id: foreignId, content: foreignContent }, tasks,
  };
}

export function parseSeeds(source: string): Array<{ seedKey: string; scope: "project" | "user"; kind: PreparedClientRecord["kind"]; content: string }> {
  const output: Array<{ seedKey: string; scope: "project" | "user"; kind: PreparedClientRecord["kind"]; content: string }> = [];
  const pattern = /seedKey:\s*"([^"\\]+)"[\s\S]*?scopeType:\s*"(project|user)"[\s\S]*?memoryType:\s*"(decision|fact|summary)"[\s\S]*?content:\s*\n\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of source.matchAll(pattern)) {
    const seedKey = match[1];
    const scope = match[2];
    const kind = match[3];
    const encoded = match[4];
    if (seedKey === undefined || encoded === undefined || (scope !== "project" && scope !== "user") || (kind !== "decision" && kind !== "fact" && kind !== "summary")) throw new Error("client A/B seed source contains an invalid entry");
    let content: unknown;
    try { content = JSON.parse(`"${encoded}"`); } catch (_error: unknown) { throw new Error(`client A/B seed ${seedKey} has invalid string content`); }
    text(content, `client A/B seed ${seedKey} content`);
    output.push({ seedKey, scope, kind, content });
  }
  if (output.length !== 14 || new Set(output.map((entry) => entry.seedKey)).size !== 14) throw new Error("client A/B must use exactly 14 tracked SEED_ENTRIES");
  return output;
}
export function makeRecord(input: Omit<PreparedClientRecord, "chunks">, chunking: Fixture["chunking"]): PreparedClientRecord {
  const chunks = chunkText({ text: input.content, ...chunking }).map((chunk) => chunk.content);
  if (chunks.length === 0) throw new Error(`client A/B record ${input.id} produced no deterministic chunks`);
  return { ...input, chunks };
}
export function assertContextSelection(task: FixtureTask, records: readonly PreparedClientRecord[], target: readonly PreparedClientRecord[]): void {
  const expected = TASK_SEED_REQUIREMENTS[task.id];
  if (expected === undefined || records.length !== expected.length || records.length >= target.length || records.some((record, index) => record.seedKey !== expected[index])) {
    throw new Error(`client A/B on condition for ${task.id} must be a proper exact-seed subset`);
  }
  const context = normalize(records.map((record) => record.content).join("\n"));
  for (const key of task.claimKeys) {
    const rule = ANSWER_KEYS[key];
    if (rule === undefined || !rule.alternatives.some((literal) => context.includes(normalize(literal))) || !rule.required.every((literal) => context.includes(normalize(literal)))) throw new Error(`client A/B context selection for ${task.id} is missing required anchor ${key}`);
  }
}

export type ClientPromptScope = Pick<ClientAbExperiment, "organizationId" | "projectKey" | "userScopeId">;
export function buildClientPrompt(
  task: Pick<PreparedClientTask, "task" | "claimKeys">,
  condition: ClientCondition,
  options: { rawCanonicalContext?: string; scope?: ClientPromptScope; packMarkdown?: string; maxOutputBytes?: number } = {},
): string {
  if (options.maxOutputBytes !== undefined) positive(options.maxOutputBytes, "maxOutputBytes");
  const prefix = `Task:\n${task.task}\n\nRequired claims (choose one exact value per key):\n${task.claimKeys.map((key) => `- ${key}: ${ANSWER_CHOICES[key]!.choices.join(" | ")}`).join("\n")}\n\n`;
  if (condition === "on") {
    if (options.packMarkdown !== undefined) {
      if (options.maxOutputBytes !== undefined) throw new Error("maxOutputBytes is supported only by the MCP roundtrip profile");
      text(options.packMarkdown, "CLI context pack");
      return `${prefix}Akasha context pack:\n${options.packMarkdown}\n\n${SHARED_PROMPT_SUFFIX}`;
    }
    const scope = options.scope;
    if (scope === undefined) throw new Error("client A/B on prompt requires its exact Akasha scope");
    return `${prefix}Use the Akasha MCP server. Call build_context_pack exactly once before answering, with exactly this JSON input and no other tool calls:\n${JSON.stringify(preflightInput(scope, task, options.maxOutputBytes))}\n\n${SHARED_PROMPT_SUFFIX}`;
  }
  text(options.rawCanonicalContext, "rawCanonicalContext");
  return `${prefix}Raw canonical context:\n${options.rawCanonicalContext}\n\n${SHARED_PROMPT_SUFFIX}`;
}
export function verifyToolTrace(condition: ClientCondition, toolCalls: readonly ToolCall[], expectedArguments?: Record<string, unknown>, allowedMemoryIds: readonly string[] = []): void {
  if (condition === "off") {
    if (toolCalls.length !== 0) throw new Error("client A/B off condition must not make tool calls");
    return;
  }
  if (toolCalls.length !== 1 || toolCalls[0]?.server !== "akasha" || toolCalls[0]?.name !== "build_context_pack") throw new Error("client A/B on condition requires exactly one Akasha build_context_pack call");
  if (expectedArguments === undefined || !isDeepStrictEqual(toolCalls[0].arguments, expectedArguments)) throw new Error("client A/B tool call must use the exact task and scope arguments");
  if (toolCalls[0].succeeded !== true) throw new Error("client A/B tool call must return a successful nonempty context pack");
  if (!toolCalls[0].selectedMemoryIds?.length || toolCalls[0].selectedMemoryIds.some((id) => !allowedMemoryIds.includes(id))) throw new Error("client A/B context pack selected records outside the preflight target scope");
}
export function contextPackMemoryIds(value: unknown): string[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  if (result.ok !== true || typeof result.packMarkdown !== "string" || !result.packMarkdown.trim() ||
      FOREIGN_SENTINEL_MARKERS.some((marker) => normalize(result.packMarkdown as string).includes(marker)) ||
      !Array.isArray(result.selectedMemoryIds) || result.selectedMemoryIds.length === 0 ||
      !result.selectedMemoryIds.every((id) => typeof id === "string" && id.trim())) return undefined;
  return result.selectedMemoryIds;
}
export function textResultData(content: unknown): unknown {
  const textContent = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter((block) => typeof block === "object" && block !== null && block.type === "text").map((block) => block.text).join("\n") : "";
  try { return JSON.parse(textContent); } catch (_error: unknown) { return undefined; }
}
export function jsonLines(value: string, label: string): Record<string, unknown>[] {
  const lines = value.split("\n").filter((line) => line.trim());
  if (lines.length === 0) throw new Error(`${label} emitted no JSON events`);
  return lines.map((line, index) => {
    try {
      const parsed: unknown = JSON.parse(line);
      object(parsed, `${label} event ${index}`);
      return parsed;
    } catch (_error: unknown) {
      throw new Error(`${label} event ${index} must be a JSON object`);
    }
  });
}
export function usage(value: unknown, label: string, includesCachedInput: boolean): Pick<ClientUsage, "inputTokens" | "cachedInputTokens"> {
  object(value, `${label} usage`);
  nonNegative(value.input_tokens, `${label} usage.input_tokens`);
  const created = value.cache_creation_input_tokens ?? 0;
  const read = value.cache_read_input_tokens ?? value.cached_input_tokens ?? 0;
  nonNegative(created, `${label} usage.cache_creation_input_tokens`);
  nonNegative(read, `${label} usage.cache_read_input_tokens`);
  return includesCachedInput ? { inputTokens: value.input_tokens, cachedInputTokens: read } : { inputTokens: value.input_tokens + created + read, cachedInputTokens: created + read };
}
export function parseCodexEvents(value: string): ClientUsage {
  const events = jsonLines(value, "Codex");
  if (events.some((event) => event.type === "turn.failed" || event.type === "error" || event.error != null)) {
    throw new Error("Codex emitted a failed turn or top-level error");
  }
  const completed = events.filter((event) => event.type === "turn.completed");
  if (completed.length !== 1) throw new Error("Codex must emit exactly one turn.completed event");
  const toolCalls = events.flatMap<ToolCall>((event) => {
    if (event.type !== "item.completed") return [];
    object(event.item, "Codex item.completed item");
    if (event.item.type === "mcp_tool_call") {
      if (event.item.status !== "completed" || event.item.error != null) throw new Error("Codex MCP tool call did not complete successfully", { cause: event.item });
      const result = event.item.result;
      object(result, "Codex MCP result");
      const data = result.structured_content != null ? result.structured_content : textResultData(result.content);
      assertObservedPackBudget(data, typeof event.item.arguments === "object" && event.item.arguments !== null ? (event.item.arguments as Record<string, unknown>).maxOutputBytes : undefined);
      const selectedMemoryIds = contextPackMemoryIds(data);
      return [{
        arguments: event.item.arguments,
        succeeded: result.isError !== true && selectedMemoryIds !== undefined,
        selectedMemoryIds,
        payloadBytes: measureToolPayloadBytes(event.item.arguments, result),
        server: typeof event.item.server === "string" ? event.item.server : typeof event.item.server_name === "string" ? event.item.server_name : "builtin",
        name: typeof event.item.tool === "string" ? event.item.tool : typeof event.item.name === "string" ? event.item.name : "unknown",
      }];
    }
    if (!["command_execution", "file_change", "web_search", "collab_tool_call", "function_call", "tool_call"].includes(String(event.item.type))) return [];
    return [{
      server: "builtin",
      name: String(event.item.type),
    }];
  });
  return { ...usage(completed[0]!.usage, "Codex", true), toolCalls };
}
export function parseCodexFinalOutput(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (_error: unknown) {
    throw new Error("Codex must leave structured final JSON");
  }
  object(parsed, "Codex structured final JSON");
  object(parsed.claims, "Codex structured final claims object");
  return parsed;
}
export function parseClaudeStream(value: string, expectedModel: string): ClaudeStreamResult {
  text(expectedModel, "expectedModel");
  const events = jsonLines(value, "Claude");
  if (events.some((event) => event.type === "error")) throw new Error("Claude emitted a top-level error event");
  const results = events.filter((event) => event.type === "result");
  if (results.length !== 1) throw new Error("Claude must emit exactly one result event");
  const result = results[0]!;
  if (result.subtype !== "success" || result.is_error !== false) throw new Error("Claude result must explicitly report subtype=success and is_error=false");
  object(result.modelUsage, "Claude result modelUsage");
  const observedModels = Object.keys(result.modelUsage);
  if (observedModels.length !== 1 || observedModels[0] !== expectedModel) throw new Error("Claude modelUsage must contain only the requested model; fallback results are not accepted");
  if (result.structured_output === undefined) throw new Error("Claude result must contain structured_output");
  const toolCalls = events.flatMap<ToolCall>((event) => {
    if (event.type !== "assistant") return [];
    object(event.message, "Claude assistant message");
    if (!Array.isArray(event.message.content)) throw new Error("Claude assistant message content must be an array");
    return event.message.content.flatMap((block) => {
      object(block, "Claude assistant content block");
      if (block.type !== "tool_use") return [];
      text(block.name, "Claude tool_use name");
      const prefix = "mcp__akasha__";
      text(block.id, "Claude tool_use id");
      const matching = events.flatMap((candidate) => {
        if (candidate.type !== "user" && candidate.type !== "assistant") return [];
        object(candidate.message, "Claude tool-result message");
        return Array.isArray(candidate.message.content) ? candidate.message.content.filter((item) => typeof item === "object" && item !== null && item.type === "tool_result" && item.tool_use_id === block.id) : [];
      });
      const data = matching.length === 1 && matching[0].is_error !== true ? textResultData(matching[0].content) : undefined;
      assertObservedPackBudget(data, typeof block.input === "object" && block.input !== null ? (block.input as Record<string, unknown>).maxOutputBytes : undefined);
      const selectedMemoryIds = contextPackMemoryIds(data);
      return [{
        server: block.name.startsWith(prefix) ? "akasha" : "builtin",
        name: block.name.startsWith(prefix) ? block.name.slice(prefix.length) : block.name,
        arguments: block.input,
        succeeded: selectedMemoryIds !== undefined,
        selectedMemoryIds,
        payloadBytes: measureToolPayloadBytes(block.input, matching.length === 1 ? matching[0] : undefined),
      }];
    });
  });
  return { ...usage(result.usage, "Claude", false), toolCalls, structuredOutput: result.structured_output, observedModel: observedModels[0]! };
}
export function gradeClientAnswer(task: Pick<PreparedClientTask, "claimKeys"> & { id?: string }, rawOutput: string): { success: boolean; omissions: string[]; contradictions: string[]; leakage: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(rawOutput); } catch (_error: unknown) { return { success: false, omissions: [...task.claimKeys], contradictions: [], leakage: [] }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { success: false, omissions: [...task.claimKeys], contradictions: [], leakage: [] };
  const claims = (parsed as Record<string, unknown>).claims;
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return { success: false, omissions: [...task.claimKeys], contradictions: [], leakage: [] };
  const claimObject = claims as Record<string, unknown>;
  const exactKeys = Object.keys(claimObject).sort().join("\n") === [...task.claimKeys].sort().join("\n");
  const output = normalize(JSON.stringify(parsed));
  const leakage = FOREIGN_SENTINEL_MARKERS.filter((marker) => output.includes(marker)).map(() => "foreign-sentinel");
  const omissions: string[] = [];
  const contradictions: string[] = [];
  for (const key of task.claimKeys) {
    const expected = ANSWER_CHOICES[key]?.expected;
    const claim = claimObject[key];
    const normalizedClaim = typeof claim === "string" ? normalize(claim) : "";
    if (!normalizedClaim) omissions.push(key);
    else if (expected === undefined || normalizedClaim !== expected) contradictions.push(key);
  }
  return { success: exactKeys && omissions.length === 0 && contradictions.length === 0 && leakage.length === 0, omissions, contradictions, leakage };
}
export function aggregateClientPairs(vendor: ClientVendor, pairs: readonly ClientPair[]): ClientPairSummary {
  if (pairs.some((pair) => pair.vendor !== vendor)) throw new Error(`${vendor} A/B evaluation must not mix vendors`);
  if (pairs.length !== 9) throw new Error(`${vendor} A/B evaluation requires exactly nine paired runs`);
  const seen = new Set<string>();
  const tasks = new Map<string, number>();
  const reductions: number[] = [];
  let allPairsSuccessful = true;
  for (const pair of pairs) {
    text(pair.taskId, "client A/B pair taskId");
    positive(pair.repeat, "client A/B pair repeat");
    nonNegative(pair.off.inputTokens, "client A/B off inputTokens");
    nonNegative(pair.on.inputTokens, "client A/B on inputTokens");
    if (pair.off.inputTokens === 0) throw new Error("client A/B off inputTokens must be greater than zero");
    const key = `${pair.taskId}:${pair.repeat}`;
    if (seen.has(key)) throw new Error(`client A/B evaluation repeats pair ${key}`);
    seen.add(key);
    tasks.set(pair.taskId, (tasks.get(pair.taskId) ?? 0) + 1);
    allPairsSuccessful &&= pair.off.success && pair.on.success;
    reductions.push((pair.off.inputTokens - pair.on.inputTokens) / pair.off.inputTokens);
  }
  if (tasks.size !== 3 || [...tasks.values()].some((count) => count !== 3)) throw new Error(`${vendor} A/B evaluation requires three tasks with three repeats each`);
  reductions.sort((left, right) => left - right);
  const medianInputTokenReduction = reductions[4]!;
  return { vendor, pairCount: 9, allPairsSuccessful, medianInputTokenReduction, passed: allPairsSuccessful && medianInputTokenReduction >= 0.15 };
}

export type LiveMcpServer = { command: string; args: readonly string[]; env?: Record<string, string> };
export type ClientCommand = { binary: string; args: string[]; env: Record<string, string | undefined>; cwd: string; stdin: string; finalOutputPath: string };
export function assertPaidClientExecutionAllowed(env: Record<string, string | undefined>, executePaid: boolean): void {
  if (!executePaid || env.AKASHA_ALLOW_PAID_CLIENT_EVAL !== "1") throw new Error("paid client evaluation requires AKASHA_ALLOW_PAID_CLIENT_EVAL=1 and --execute-paid");
}
export function wordEstimate(value: string): number {
  return value.match(/\S+/g)?.length ?? 0;
}
export function preflightInput(experiment: ClientPromptScope, task: Pick<PreparedClientTask, "task">, maxOutputBytes?: number) {
  if (maxOutputBytes !== undefined) positive(maxOutputBytes, "maxOutputBytes");
  return {
    organizationId: experiment.organizationId,
    projectKey: experiment.projectKey,
    task: task.task,
    userScopeId: experiment.userScopeId,
    includeUser: true,
    limit: 10,
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
  };
}
export function assertClientContextPack(task: PreparedClientTask, pack: { packMarkdown: string; selectedMemoryIds: readonly string[] }, allowedMemoryIds: readonly string[], requiredMemoryIds: readonly string[]): void {
  text(pack.packMarkdown, "client A/B context pack");
  const selected = pack.selectedMemoryIds;
  if (!Array.isArray(selected) || selected.length === 0 || selected.length >= allowedMemoryIds.length || new Set(selected).size !== selected.length || selected.some((id) => !allowedMemoryIds.includes(id))) {
    throw new Error(`client A/B preflight for ${task.id} selected records outside its proper target subset`);
  }
  const normalized = normalize(pack.packMarkdown);
  if (FOREIGN_SENTINEL_MARKERS.some((marker) => normalized.includes(marker))) throw new Error(`client A/B preflight for ${task.id} leaked the foreign sentinel`);
  if (requiredMemoryIds.length === 0 || requiredMemoryIds.some((id) => !selected.includes(id))) throw new Error(`client A/B preflight for ${task.id} missed a required seed memory`);
  for (const key of task.claimKeys) {
    const rule = ANSWER_KEYS[key];
    if (rule === undefined || !rule.alternatives.some((literal) => normalized.includes(normalize(literal))) || !rule.required.every((literal) => normalized.includes(normalize(literal)))) throw new Error(`client A/B preflight for ${task.id} missed required anchor ${key}`);
  }
}
export function clientAbRunPlan(experiment: ClientAbExperiment): Array<{ task: PreparedClientTask; repeat: number; condition: ClientCondition }> {
  const plan: Array<{ task: PreparedClientTask; repeat: number; condition: ClientCondition }> = [];
  for (const task of experiment.tasks) {
    for (const repeat of [1, 2, 3] as const) {
      for (const condition of repeat === 2 ? ["on", "off"] as const : ["off", "on"] as const) plan.push({ task, repeat, condition });
    }
  }
  return plan;
}
export function observedCodexModel(stdout: string): string | null {
  const completed = jsonLines(stdout, "Codex").find((event) => event.type === "turn.completed");
  if (completed === undefined) return null;
  const candidate = typeof completed.model === "string"
    ? completed.model
    : typeof completed.turn === "object" && completed.turn !== null && !Array.isArray(completed.turn) && typeof (completed.turn as Record<string, unknown>).model === "string"
      ? (completed.turn as Record<string, string>).model
      : undefined;
  return candidate ?? null;
}
export type CodexSubscriptionStatus = { checkedAt: string; weeklyRemainingPercent: number; creditBalance: string };
export function parseCodexSubscriptionStatus(account: unknown, usage: unknown): CodexSubscriptionStatus {
  object(account, "Codex account response");
  object(account.account, "Codex authenticated account");
  if (account.account.type !== "chatgpt" || account.requiresOpenaiAuth !== true) throw new Error("Codex subscription evaluation requires ChatGPT authentication");
  object(usage, "Codex usage response");
  if (usage.ordinaryUsageAllowed !== true) throw new Error("Codex included usage permission is unavailable or exhausted");
  const buckets = usage.rateLimitsByLimitId;
  const limits = typeof buckets === "object" && buckets !== null && !Array.isArray(buckets)
    ? (buckets as Record<string, unknown>).codex : usage.rateLimits;
  object(limits, "Codex rate limits");
  if (limits.limitId !== "codex" || limits.spendControlReached !== false || limits.rateLimitReachedType != null) throw new Error("Codex usage limit state is unavailable or reached");
  const windows = [limits.primary, limits.secondary].filter((window) => window != null);
  let weeklyRemainingPercent: number | undefined;
  for (const window of windows) {
    object(window, "Codex usage window");
    if (typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent >= 100) throw new Error("Codex usage window is unavailable or exhausted");
    if (window.windowDurationMins === 10080) weeklyRemainingPercent = 100 - window.usedPercent;
  }
  if (weeklyRemainingPercent === undefined || weeklyRemainingPercent <= 1) throw new Error("Codex weekly remaining usage is unavailable or at most 1%");
  object(limits.credits, "Codex credits");
  const creditBalance = limits.credits.balance;
  if (typeof creditBalance !== "string" || !/^\d+(?:\.\d+)?$/.test(creditBalance)) throw new Error("Codex credit balance is unavailable");
  return { checkedAt: new Date().toISOString(), weeklyRemainingPercent, creditBalance };
}
export function creditDeclined(previous: string, current: string): boolean {
  const [beforeWhole, beforeFraction = ""] = previous.split(".");
  const [afterWhole, afterFraction = ""] = current.split(".");
  const scale = Math.max(beforeFraction.length, afterFraction.length);
  return BigInt(afterWhole! + afterFraction.padEnd(scale, "0")) < BigInt(beforeWhole! + beforeFraction.padEnd(scale, "0"));
}
