import { createHash } from "node:crypto";

export type ObservedEdge = { source: string; target: string };

export type TraceIngestSummary = {
  // Relations upgraded from heuristic/inferred to proven.
  promoted: number;
  // Matched relations that were already proven (no change).
  alreadyProven: number;
  // Observed edges with no matching relation in the current index.
  unmatched: ObservedEdge[];
};

export function parseTraceInput(raw: unknown): ObservedEdge[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { edges?: unknown }).edges)
      ? (raw as { edges: unknown[] }).edges
      : null;
  if (!list) {
    throw new Error(
      'invalid trace payload: expected an array of {source, target} edges or { edges: [...] }'
    );
  }
  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`invalid trace edge at index ${index}: expected an object with source and target`);
    }
    const { source, target } = entry as { source?: unknown; target?: unknown };
    if (typeof source !== 'string' || source.length === 0) {
      throw new Error(`invalid trace edge at index ${index}: source must be a non-empty string`);
    }
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error(`invalid trace edge at index ${index}: target must be a non-empty string`);
    }
    return { source, target };
  });
}
export function traceEvidenceId(relationId: string): string {
  return createHash('sha1').update(`${relationId}:trace`).digest('hex').slice(0, 16);
}
export type TraceRelation = { id: string; kind: string; confidence: string };
