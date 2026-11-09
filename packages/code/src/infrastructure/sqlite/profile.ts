import { partitionProfile } from "../../domain/local-memory/profile.js";
import type { BranchRow, FactRow, ProfileResult } from "../../domain/local-memory/profile.js";
import { withAgentMemoryDb } from "./local-memory.js";
import type { Db } from "./store.js";

function notSupersededSql(factAlias: string, supersessionTxScopeSql: string): string {
  return `NOT EXISTS (
    SELECT 1
    FROM fact_provenance supersession_fp
    INNER JOIN facts superseding_fact ON superseding_fact.id = supersession_fp.fact_id
    INNER JOIN transactions supersession_tx ON supersession_fp.tx_id = supersession_tx.id
    WHERE supersession_fp.source_fact_id = ${factAlias}.id
      AND supersession_fp.kind = 'supersedes'
      AND superseding_fact.op = 'assert'
      AND supersession_tx.archived = 0
      AND ${supersessionTxScopeSql}
  )`;
}

function scopedFactVisibilitySql(
  factAlias: string,
  ownTxScopeSql: string,
  supersessionEdgeTxScopeSql: string
): string {
  return `((${ownTxScopeSql}) OR EXISTS (
    SELECT 1
    FROM fact_provenance visibility_fp
    INNER JOIN transactions visibility_tx ON visibility_fp.tx_id = visibility_tx.id
    WHERE visibility_fp.fact_id = ${factAlias}.id
      AND visibility_fp.kind = 'supersedes'
      AND visibility_tx.archived = 0
      AND ${supersessionEdgeTxScopeSql}
  ))`;
}

function collectProfile(
  db: Db,
  branch: BranchRow,
  entity: string,
  k: number,
  asOfTx: string | undefined
): ProfileResult {
  const useAsOf = asOfTx !== undefined;
  const conditions: string[] = ['f.entity_id = ?'];
  const params: Array<string | number> = [entity];

  if (useAsOf) {
    conditions.push(
      scopedFactVisibilitySql(
        'f',
        't.archived = 0 AND t.id IN (SELECT id FROM ancestor_txs)',
        'visibility_tx.id IN (SELECT id FROM ancestor_txs)'
      )
    );
    conditions.push(notSupersededSql('f', 'supersession_tx.id IN (SELECT id FROM ancestor_txs)'));
  } else {
    conditions.push(
      scopedFactVisibilitySql(
        'f',
        't.archived = 0 AND t.branch_id = ?',
        'visibility_tx.branch_id = ?'
      )
    );
    params.push(branch.id, branch.id);
    conditions.push(notSupersededSql('f', 'supersession_tx.branch_id = ?'));
    params.push(branch.id);
  }

  const cteHeader = useAsOf
    ? `WITH RECURSIVE ancestor_txs(id) AS (
        SELECT ?
        UNION
        SELECT tp.parent_tx_id
        FROM transaction_parents tp, ancestor_txs a
        WHERE tp.tx_id = a.id
      )`
    : '';

  const sql = `
    ${cteHeader}
    SELECT f.id, f.entity_id, f.attribute, f.value_blob, f.op, f.tx_id, f.redacted, t.ts,
           COALESCE(ad.is_code_relation, 0) AS is_code_relation
    FROM facts f
    INNER JOIN transactions t ON f.tx_id = t.id
    LEFT JOIN attribute_defs ad ON ad.name = f.attribute
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.ts DESC, f.id ASC
  `;

  const allParams: Array<string | number> = [];
  if (useAsOf) {
    allParams.push(asOfTx as string);
  }
  allParams.push(...params);

  const rows = db.prepare(sql).all(...allParams) as unknown as FactRow[];

  return partitionProfile(rows, entity, branch.name, k);
}
export type { ProfileOptions,ProfileResult } from "../../domain/local-memory/profile.js";

export function readProfile(repoRoot: string, branchName: string, entity: string, k: number, asOfTx: string | undefined): ProfileResult {
  return withAgentMemoryDb(repoRoot, true, (db) => {
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE name = ?')
      .get(branchName) as BranchRow | undefined;
    if (!branch) {
      throw new Error(`branch not found: ${branchName}`);
    }
    return collectProfile(db, branch, entity, k, asOfTx);
  });
}