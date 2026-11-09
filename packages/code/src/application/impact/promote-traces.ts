import type { ObservedEdge, TraceIngestSummary, TraceRelation } from "../../domain/impact/traces.js";

export function promoteTraces(edges: readonly ObservedEdge[], writer: {
  relations(edge: ObservedEdge): TraceRelation[];
  promote(edge: ObservedEdge, relation: TraceRelation): void;
}): TraceIngestSummary {
  let promoted = 0;
  let alreadyProven = 0;
  const unmatched: ObservedEdge[] = [];
  for (const edge of edges) {
    const rows = writer.relations(edge);
    if (rows.length === 0) { unmatched.push(edge); continue; }
    for (const row of rows) {
      if (row.confidence === 'proven') { alreadyProven++; continue; }
      writer.promote(edge, row);
      promoted++;
    }
  }
  return { promoted, alreadyProven, unmatched };
}
export interface TraceWriter {
  relations(edge: ObservedEdge): TraceRelation[];
  promote(edge: ObservedEdge, relation: TraceRelation): void;
  close(): void;
}
export function ingestTraces(root: string, edges: readonly ObservedEdge[], open: (root: string) => TraceWriter): TraceIngestSummary {
  const writer = open(root);
  try { return promoteTraces(edges, writer); } finally { writer.close(); }
}