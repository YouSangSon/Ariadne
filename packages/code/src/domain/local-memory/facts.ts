import { contentHash } from "../identity.js";
import { redactSecrets } from "../security/redaction.js";
import type { EmbeddingResult } from "./embedding.js";
import type { FactRow, FactWithEmbeddingRow, RecalledFact, RecallResult, RememberInput, RememberValue, TraceEdge, TraceResult, TraceSourceRow } from "./model.js";

export const MAX_TRACE_DEPTH = 20;

export const MAX_RECALL_K = 100;

export function uniqueFactIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => id.length > 0))];
}

export function decodeValue(row: FactRow): RememberValue | '[REDACTED]' {
  if (row.redacted === 1) {
    return '[REDACTED]';
  }
  try {
    return JSON.parse(row.value_blob) as RememberValue;
  } catch {
    return row.value_blob;
  }
}

export function rowToRecalledFact(row: FactRow): RecalledFact {
  return {
    id: row.id,
    entityId: row.entity_id,
    attribute: row.attribute,
    value: decodeValue(row),
    op: row.op,
    txId: row.tx_id,
    ts: row.ts
  };
}

export function bufferToInt8(buf: Buffer): Int8Array {
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function int8DotScore(a: Int8Array, b: Int8Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

export const ANN_OVER_FETCH_FACTOR = 5;

export const ANN_OVER_FETCH_MIN = 20;
export function prepareRemember(input: RememberInput) {
  const branchName = input.branch ?? 'main';
  const agent = input.agent ?? 'mcp:remember';
  const evidenceFactIds = uniqueFactIds(input.evidenceFactIds);
  const supersedesFactIds = uniqueFactIds(input.supersedesFactIds);
  const op = input.op ?? 'assert';
  const overlap = evidenceFactIds.find((id) => supersedesFactIds.includes(id));
  if (overlap) throw new Error(`fact cannot be both evidence and superseded source: ${overlap}`);
  if (op === 'retract' && supersedesFactIds.length > 0) throw new Error('retract facts cannot supersede other facts');
  const valueStr = JSON.stringify(input.value);
  const isRedacted = redactSecrets(valueStr) !== valueStr;
  const finalValue = isRedacted ? '[REDACTED]' : valueStr;
  const factId = contentHash(input.entity, input.attribute, finalValue, op);
  if (supersedesFactIds.includes(factId)) throw new Error(`fact cannot supersede itself: ${factId}`);
  return { branchName, agent, evidenceFactIds, supersedesFactIds, op, valueStr, isRedacted, finalValue, factId };
}

export function traceFactSources(startRow: FactRow, depth: number, sources: (frontier: string[]) => TraceSourceRow[]): TraceResult {
  const chain: RecalledFact[] = [rowToRecalledFact(startRow)];
  const edges: TraceEdge[] = [];
  const visited = new Set<string>([startRow.id]);
  const visitedEdges = new Set<string>();
  let frontier: string[] = [startRow.id];

  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const sourceRows = sources(frontier);

    const next: string[] = [];
    for (const source of sourceRows) {
      const edgeKey = `${source.edge_fact_id}\0${source.edge_source_fact_id}\0${source.edge_kind}`;
      if (!visitedEdges.has(edgeKey)) {
        visitedEdges.add(edgeKey);
        edges.push({
          factId: source.edge_fact_id,
          sourceFactId: source.edge_source_fact_id,
          kind: source.edge_kind
        });
      }
      if (!visited.has(source.id)) {
        visited.add(source.id);
        chain.push(rowToRecalledFact(source));
        next.push(source.id);
      }
    }
    frontier = next;
  }

  return { chain, edges };
}

export function rankSemanticFacts(rows: FactWithEmbeddingRow[], queryEmbedding: EmbeddingResult, k: number): RecallResult {
  const queryVec = bufferToInt8(queryEmbedding.vector);
  const scored = rows
    .map((row) => ({ row, score: int8DotScore(queryVec, bufferToInt8(row.vector)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return { facts: scored.map((entry) => rowToRecalledFact(entry.row)) };
}
