import { contentHash } from "../../domain/identity.js";
import { factId } from "../../domain/local-memory/session.js";
import type { PersistSessionInput, PersistSessionResult } from "../../domain/local-memory/session.js";
import { getRepoId, openDatabase } from "./store.js";
import type { Db } from "./store.js";

export function persistSessionFacts(repoRoot: string, input: PersistSessionInput): PersistSessionResult {
  const summaryBlob = JSON.stringify(input.summaryValue);
  const referenceValues = input.referencedFiles.map((file) => `file:${file}`);

  const db = openDatabase(repoRoot);
  try {
    getRepoId(db, repoRoot);
    const branch = loadBranch(db, input.branch ?? 'main');
    const summaryFactId = factId(input.sessionEntityId, 'session_summary', summaryBlob, branch.id);
    const referenceFactIds = referenceValues.map((value) =>
      factId(input.sessionEntityId, 'references_file', JSON.stringify(value), branch.id)
    );
    const allFactsExist =
      factExists(db, summaryFactId) &&
      referenceFactIds.every((referenceFactId) =>
        factExists(db, referenceFactId) && provenanceExists(db, referenceFactId, summaryFactId)
      );
    if (allFactsExist) {
      return { summaryFactId, referenceFactIds, factsWritten: 0 };
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      ensureAttributeDef(db, 'session_summary', 'Imported coding agent session crystal summary');
      ensureAttributeDef(db, 'references_file', 'Repo-relative file referenced by an imported coding agent session');

      const ts = new Date().toISOString();
      const txId = contentHash(branch.head_tx_id ?? '', branch.id, ts, input.agent, input.sessionId);
      db.prepare(
        'INSERT OR IGNORE INTO transactions (id, parent_tx_id, branch_id, ts, agent, index_run_id) VALUES (?, ?, ?, ?, ?, NULL)'
      ).run(txId, branch.head_tx_id, branch.id, ts, input.agent);
      if (branch.head_tx_id) {
        db.prepare('INSERT OR IGNORE INTO transaction_parents (tx_id, parent_tx_id) VALUES (?, ?)').run(
          txId,
          branch.head_tx_id
        );
      }

      let factsWritten = insertFact(db, {
        id: summaryFactId,
        entity: input.sessionEntityId,
        attribute: 'session_summary',
        valueBlob: summaryBlob,
        txId
      });
      for (let index = 0; index < referenceValues.length; index++) {
        const referenceFactId = referenceFactIds[index]!;
        factsWritten += insertFact(db, {
          id: referenceFactId,
          entity: input.sessionEntityId,
          attribute: 'references_file',
          valueBlob: JSON.stringify(referenceValues[index]!),
          txId
        });
        db.prepare(
          'INSERT OR IGNORE INTO fact_provenance (id, fact_id, source_fact_id, kind, tx_id) VALUES (?, ?, ?, ?, ?)'
        ).run(contentHash(referenceFactId, summaryFactId, 'session_import'), referenceFactId, summaryFactId, 'evidence', txId);
      }

      db.prepare('UPDATE branches SET head_tx_id = ? WHERE id = ?').run(txId, branch.id);
      db.exec('COMMIT');
      return { summaryFactId, referenceFactIds, factsWritten };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function factExists(db: Db, id: string): boolean {
  const row = db.prepare('SELECT 1 AS one FROM facts WHERE id = ?').get(id) as { one: number } | undefined;
  return row !== undefined;
}

export function provenanceExists(db: Db, factIdValue: string, sourceFactId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS one FROM fact_provenance WHERE fact_id = ? AND source_fact_id = ?')
    .get(factIdValue, sourceFactId) as { one: number } | undefined;
  return row !== undefined;
}

export function loadBranch(db: Db, name: string): { id: string; head_tx_id: string | null } {
  const row = db
    .prepare('SELECT id, head_tx_id FROM branches WHERE name = ?')
    .get(name) as { id: string; head_tx_id: string | null } | undefined;
  if (!row) throw new Error(`branch not found: ${name}`);
  return row;
}

export function ensureAttributeDef(db: Db, name: string, description: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO attribute_defs (name, value_type, is_code_relation, description) VALUES (?, 'json', 0, ?)"
  ).run(name, description);
}

export function insertFact(
  db: Db,
  input: { id: string; entity: string; attribute: string; valueBlob: string; txId: string }
): number {
  const result = db
    .prepare('INSERT OR IGNORE INTO facts (id, entity_id, attribute, value_blob, op, tx_id, redacted) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(input.id, input.entity, input.attribute, input.valueBlob, 'assert', input.txId, 0) as { changes?: number };
  return result.changes ?? 0;
}