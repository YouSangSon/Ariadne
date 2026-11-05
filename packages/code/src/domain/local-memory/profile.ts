import type { RecalledFact, RememberValue } from "./model.js";

export interface ProfileOptions {
  entity: string;
  branch?: string;
  k?: number;
  asOfTx?: string;
}

export interface ProfileResult {
  readonly entity: string;
  readonly branch: string;
  readonly staticFacts: ReadonlyArray<RecalledFact>;
  readonly dynamicFacts: ReadonlyArray<RecalledFact>;
  readonly summaryFacts: ReadonlyArray<RecalledFact>;
}

export const DEFAULT_K_PER_PARTITION = 50;

export const REFLECTION_ATTRIBUTE = 'reflection';

export interface FactRow {
  id: string;
  entity_id: string;
  attribute: string;
  value_blob: string;
  op: 'assert' | 'retract';
  tx_id: string;
  redacted: number;
  ts: string;
  is_code_relation: number;
}

export interface BranchRow {
  id: string;
  name: string;
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
export function partitionProfile(rows: FactRow[], entity: string, branchName: string, k: number): ProfileResult {
  const staticFacts: RecalledFact[] = [];
  const dynamicFacts: RecalledFact[] = [];
  const summaryFacts: RecalledFact[] = [];
  for (const row of rows) {
    const recalled = rowToRecalledFact(row);
    if (row.attribute === REFLECTION_ATTRIBUTE) {
      if (summaryFacts.length < k) summaryFacts.push(recalled);
    } else if (row.is_code_relation === 1) {
      if (staticFacts.length < k) staticFacts.push(recalled);
    } else {
      if (dynamicFacts.length < k) dynamicFacts.push(recalled);
    }
  }

  return {
    entity,
    branch: branchName,
    staticFacts,
    dynamicFacts,
    summaryFacts
  };
}
