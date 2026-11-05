import { redactSecrets } from "../security/redaction.js";
import type { EmbeddingResult } from "./embedding.js";

export interface ReflectOptions {
  branch?: string;
  olderThanDays?: number;
  entity?: string;
  agent?: string;
  dryRun?: boolean;
}

export interface ReflectedEntity {
  entity: string;
  summaryFactId: string;
  sourceCount: number;
}

export interface ReflectResult {
  branch: string;
  model: string;
  summarized: number;
  skippedEntities: number;
  reflections: ReflectedEntity[];
}

export interface RepairOptions {
  branch?: string;
  dryRun?: boolean;
}

export interface OrphanReflection {
  summaryFactId: string;
  entity: string;
  sourceFactCount: number;
}

export interface RepairResult {
  branch: string;
  scanned: number;
  repaired: number;
  dryRun: boolean;
  orphans: OrphanReflection[];
}

export const DEFAULT_OLDER_THAN_DAYS = 30;

export const REFLECTION_ATTRIBUTE = 'reflection';

export const MIN_FACTS_PER_ENTITY = 2;

export const DEFAULT_MAX_FACTS_PER_ENTITY = 50;

export const SYSTEM_PROMPT =
  'You summarize an entity\'s observed history into one or two sentences.\n' +
  'Describe only what was observed across the bullet list. Do not invent details.\n' +
  'If observations contradict each other, mention the contradiction.';

export interface FactRow {
  id: string;
  entity_id: string;
  attribute: string;
  value_blob: string;
  ts: string;
}

export interface EntityCandidates {
  facts: FactRow[];
  totalCount: number;
}

export interface BranchRow {
  id: string;
  name: string;
}

export function renderUserPrompt(entity: string, candidates: EntityCandidates): string {
  const lines = candidates.facts.map((row) => {
    const compactValue = redactSecrets(row.value_blob, 200);
    return `- [${row.ts}] ${row.attribute}: ${compactValue}`;
  });
  if (candidates.totalCount > candidates.facts.length) {
    const omitted = candidates.totalCount - candidates.facts.length;
    lines.push(
      `(... and ${omitted} more newer observation${omitted === 1 ? '' : 's'} omitted from this summary)`
    );
  }
  return `Entity: ${entity}\nObservations:\n${lines.join('\n')}`;
}

export interface ReflectionDraft {
  entity: string;
  sourceFactIds: string[];
  summary: string;
  model: string;
  embedding: EmbeddingResult | null;
}

export interface OrphanRow {
  summary_fact_id: string;
  entity_id: string;
  source_count: number;
}