import { contentHash } from "../../domain/identity.js";
import { REFLECTION_ATTRIBUTE } from "../../domain/local-memory/reflection.js";
import type { BranchRow, EntityCandidates, FactRow, OrphanReflection, OrphanRow, ReflectedEntity, ReflectionDraft, RepairOptions, RepairResult } from "../../domain/local-memory/reflection.js";
import { remember, withAgentMemoryDb } from "./local-memory.js";
import type { Db } from "./store.js";

function collectCandidates(
  db: Db,
  branchId: string,
  cutoff: string,
  entityFilter: string | undefined,
  factCap: number
): Map<string, EntityCandidates> {
  const conditions = [
    't.branch_id = ?',
    't.archived = 0',
    't.ts < ?',
    'f.redacted = 0',
    "f.op = 'assert'",
    'f.attribute != ?'
  ];
  const params: Array<string | number> = [branchId, cutoff, REFLECTION_ATTRIBUTE];
  if (entityFilter) {
    conditions.push('f.entity_id = ?');
    params.push(entityFilter);
  }
  // ORDER BY entity_id keeps a single entity's rows contiguous so each
  // EntityCandidates entry can be filled without reshuffling. ts ASC
  // means the kept slice is the OLDEST window — the common case where a
  // long-lived entity has too many observations and we want the early
  // history summarized while the recent activity stays as raw episodic
  // facts. The footer carries a count of the omitted newer rows.
  const sql = `
    SELECT f.id, f.entity_id, f.attribute, f.value_blob, t.ts
    FROM facts f
    INNER JOIN transactions t ON f.tx_id = t.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY f.entity_id, t.ts ASC
  `;
  // iterate() streams rows one at a time so the SELECT result set is
  // never fully materialised in memory. Per-entity arrays are bounded
  // by factCap; remaining rows still bump totalCount so the prompt can
  // disclose the truncation.
  const stmt = db.prepare(sql);
  const grouped = new Map<string, EntityCandidates>();
  for (const raw of stmt.iterate(...params)) {
    const row = raw as unknown as FactRow;
    let entry = grouped.get(row.entity_id);
    if (!entry) {
      entry = { facts: [], totalCount: 0 };
      grouped.set(row.entity_id, entry);
    }
    entry.totalCount += 1;
    if (entry.facts.length < factCap) {
      entry.facts.push(row);
    }
  }
  return grouped;
}

function persistReflections(
  db: Db,
  branchName: string,
  drafts: ReflectionDraft[],
  agentOverride: string | undefined,
  olderThanDays: number
): ReflectedEntity[] {
  const branch = db
    .prepare('SELECT id, name FROM branches WHERE name = ?')
    .get(branchName) as BranchRow | undefined;
  if (!branch) {
    throw new Error(`branch not found: ${branchName}`);
  }

  const reflectionInsert = db.prepare(
    `INSERT OR IGNORE INTO reflections
       (id, branch_id, model, summary_fact_id, source_fact_count, criteria_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  );
  const provenanceMark = db.prepare(
    "UPDATE fact_provenance SET kind = 'summary' WHERE fact_id = ? AND source_fact_id = ?"
  );
  const savepointStart = db.prepare("SAVEPOINT reflection_mark");
  const savepointRelease = db.prepare("RELEASE reflection_mark");
  const savepointRollback = db.prepare("ROLLBACK TO reflection_mark");

  // Per-draft atomicity: remember() runs its own BEGIN/COMMIT internally
  // (autocommit returns control here). After it commits, we open a
  // SAVEPOINT for the provenance UPDATE + reflections audit INSERT so a
  // crash mid-way rolls those back together. The summary fact stays
  // (remember already committed it); orphan summary facts are detectable
  // by lacking a matching reflections row and can be repaired by a
  // follow-up reflect --repair pass (out of scope here). The async-
  // outside-tx invariant is preserved because all embeddings were
  // pre-computed before reaching this function.
  const written: ReflectedEntity[] = [];
  for (const draft of drafts) {
    const remembered = remember(
      db,
      {
        entity: draft.entity,
        attribute: REFLECTION_ATTRIBUTE,
        value: draft.summary,
        evidenceFactIds: draft.sourceFactIds,
        branch: branchName,
        agent: agentOverride ?? `reflect:${draft.model}`
      },
      draft.embedding
    );

    savepointStart.run();
    try {
      for (const sourceFactId of draft.sourceFactIds) {
        provenanceMark.run(remembered.factId, sourceFactId);
      }
      const reflectionId = contentHash(
        'reflection',
        remembered.factId,
        draft.model,
        String(draft.sourceFactIds.length)
      );
      reflectionInsert.run(
        reflectionId,
        branch.id,
        draft.model,
        remembered.factId,
        draft.sourceFactIds.length,
        JSON.stringify({ olderThanDays, entity: draft.entity })
      );
      savepointRelease.run();
    } catch (error: unknown) {
      savepointRollback.run();
      savepointRelease.run();
      throw error;
    }

    written.push({
      entity: draft.entity,
      summaryFactId: remembered.factId,
      sourceCount: draft.sourceFactIds.length
    });
  }
  return written;
}

/**
 * Repair sweep for orphan summary facts. A reflectFacts pass writes a
 * summary fact via remember() (which commits autonomously), then takes
 * a SAVEPOINT to mark provenance edges kind='summary' and insert the
 * reflections audit row. If the process is killed between those two
 * commits, the summary fact survives but the provenance/audit are
 * incomplete — an orphan.
 *
 * Detection: a fact with attribute='reflection' that has no matching
 * row in the reflections audit table. We treat it as orphan regardless
 * of whether all of its provenance edges are kind='evidence' (the
 * intermediate state where some edges are 'summary' but the audit row
 * is missing also qualifies; the UPDATE is idempotent).
 *
 * Repair (per orphan, atomically inside a SAVEPOINT):
 *   1. UPDATE fact_provenance SET kind='summary' WHERE fact_id=<orphan>
 *      AND kind='evidence'  -- only flips remaining 'evidence' edges so
 *      mixed-state orphans converge on full 'summary'.
 *   2. INSERT OR IGNORE INTO reflections — synthesizes a 'repair' audit
 *      with model='repair' so future readers can distinguish this from
 *      a fresh reflectFacts pass.
 *
 * The function is async to match the project's sync-vs-async pattern
 * (rememberOnRepo / reflectFacts) even though no I/O outside SQLite is
 * required — keeping the wrapper shape consistent.
 *
 * Decision rationale: D-015 (separate `--repair` trigger).
 */
export async function repairReflections(
  repoRoot: string,
  options: RepairOptions = {}
): Promise<RepairResult> {
  const branchName = options.branch ?? 'main';
  const dryRun = options.dryRun === true;

  return withAgentMemoryDb(repoRoot, !options.dryRun ? false : true, (db) => {
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE name = ?')
      .get(branchName) as BranchRow | undefined;
    if (!branch) {
      throw new Error(`branch not found: ${branchName}`);
    }

    const orphanRows = db
      .prepare(
        `SELECT f.id AS summary_fact_id, f.entity_id AS entity_id,
                (SELECT COUNT(*) FROM fact_provenance fp WHERE fp.fact_id = f.id) AS source_count
         FROM facts f
         INNER JOIN transactions t ON f.tx_id = t.id
         WHERE t.branch_id = ?
           AND t.archived = 0
           AND f.attribute = ?
           AND f.op = 'assert'
           AND NOT EXISTS (
             SELECT 1 FROM reflections r WHERE r.summary_fact_id = f.id
           )`
      )
      .all(branch.id, REFLECTION_ATTRIBUTE) as unknown as OrphanRow[];

    const orphans: OrphanReflection[] = orphanRows.map((row) => ({
      summaryFactId: row.summary_fact_id,
      entity: row.entity_id,
      sourceFactCount: row.source_count
    }));

    if (orphans.length === 0 || dryRun) {
      return {
        branch: branchName,
        scanned: orphans.length,
        repaired: 0,
        dryRun,
        orphans
      };
    }

    const promoteKind = db.prepare(
      "UPDATE fact_provenance SET kind = 'summary' WHERE fact_id = ? AND kind = 'evidence'"
    );
    const insertAudit = db.prepare(
      `INSERT OR IGNORE INTO reflections
         (id, branch_id, model, summary_fact_id, source_fact_count, criteria_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    );
    const savepointStart = db.prepare("SAVEPOINT reflection_repair");
    const savepointRelease = db.prepare("RELEASE reflection_repair");
    const savepointRollback = db.prepare("ROLLBACK TO reflection_repair");

    let repaired = 0;
    for (const orphan of orphans) {
      savepointStart.run();
      try {
        promoteKind.run(orphan.summaryFactId);
        const auditId = contentHash(
          'reflection-repair',
          orphan.summaryFactId,
          String(orphan.sourceFactCount)
        );
        insertAudit.run(
          auditId,
          branch.id,
          'repair',
          orphan.summaryFactId,
          orphan.sourceFactCount,
          JSON.stringify({ kind: 'repair', branch: branchName })
        );
        savepointRelease.run();
        repaired += 1;
      } catch (error: unknown) {
        savepointRollback.run();
        savepointRelease.run();
        throw error;
      }
    }

    return {
      branch: branchName,
      scanned: orphans.length,
      repaired,
      dryRun,
      orphans
    };
  });
}
export type { OrphanReflection,ReflectedEntity,ReflectOptions,ReflectResult,RepairOptions,RepairResult } from "../../domain/local-memory/reflection.js";

export function reflectionCandidates(repoRoot: string, branchName: string, cutoff: string, entity: string | undefined, factCap: number): Map<string, EntityCandidates> {
  return withAgentMemoryDb(repoRoot, true, (db) => {
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE name = ?')
      .get(branchName) as BranchRow | undefined;
    if (!branch) {
      throw new Error(`branch not found: ${branchName}`);
    }
    return collectCandidates(db, branch.id, cutoff, entity, factCap);
  });

}

export function writeReflections(repoRoot: string, branchName: string, drafts: ReflectionDraft[], agent: string | undefined, olderThanDays: number): ReflectedEntity[] {
  return withAgentMemoryDb(repoRoot, false, (db) => persistReflections(db, branchName, drafts, agent, olderThanDays));
}