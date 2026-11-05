export type RememberValue = string | number | boolean | null | RememberValue[] | { [key: string]: RememberValue };

export interface RememberInput {
  entity: string;
  attribute: string;
  value: RememberValue;
  evidenceFactIds?: string[];
  supersedesFactIds?: string[];
  branch?: string;
  agent?: string;
  op?: 'assert' | 'retract';
}

export interface RememberResult {
  factId: string;
  txId: string;
}

export interface RecallInput {
  query?: string;
  entity?: string;
  attribute?: string;
  branch?: string;
  k?: number;
  asOfTx?: string;
  currentOnly?: boolean;
  semantic?: boolean;
}

export interface RecalledFact {
  id: string;
  entityId: string;
  attribute: string;
  value: RememberValue | '[REDACTED]';
  op: 'assert' | 'retract';
  txId: string;
  ts: string;
}

export interface RecallResult {
  facts: RecalledFact[];
}

export interface BranchInput {
  name: string;
  from?: string;
}

export interface BranchResult {
  branchId: string;
  headTxId: string | null;
}

export interface MergeBranchInput {
  target: string;
  source: string;
  agent?: string;
}

export interface MergeBranchResult {
  mergeTxId: string;
  targetBranchId: string;
  sourceBranchId: string;
  previousTargetHead: string | null;
  sourceHead: string;
}

export interface TraceInput {
  factId: string;
  depth?: number;
}

export interface TraceEdge {
  factId: string;
  sourceFactId: string;
  kind: string;
}

export interface TraceResult {
  chain: RecalledFact[];
  edges: TraceEdge[];
}

export interface BranchRow {
  id: string;
  name: string;
  head_tx_id: string | null;
}

export interface FactRow {
  id: string;
  entity_id: string;
  attribute: string;
  value_blob: string;
  op: 'assert' | 'retract';
  tx_id: string;
  redacted: number;
  ts: string;
}

export interface TraceSourceRow extends FactRow {
  edge_fact_id: string;
  edge_source_fact_id: string;
  edge_kind: string;
}

export interface FactWithEmbeddingRow extends FactRow {
  vector: Buffer;
  dim: number;
}

export interface ReindexVecOptions {
  model?: string;
}

export interface ReindexVecResult {
  extensionLoaded: boolean;
  models: Array<{ model: string; dim: number; written: number }>;
}

export interface ReembedOptions {
  model?: string;
  all?: boolean;
}

export interface ReembedResult {
  model: string;
  embedded: number;
  candidates: number;
}

export interface ReembedCandidate {
  id: string;
  entity_id: string;
  attribute: string;
  value_blob: string;
}