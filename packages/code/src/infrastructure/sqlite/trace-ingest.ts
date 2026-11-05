import type { TraceWriter } from "../../application/impact/promote-traces.js";
import { traceEvidenceId } from "../../domain/impact/traces.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { ensureRepo, latestCompletedIndexRun, openDatabase } from "./store.js";

export function openTraceWriter(repoRoot: string): TraceWriter {
  const root = normalizeRepoRoot(repoRoot);
  const db = openDatabase(root, {});
  try {
    const repoId = ensureRepo(db, root);
    const indexRunId = latestCompletedIndexRun(db, repoId);

    const selectRelations = db.prepare(
      `SELECT id, kind, confidence, source_entity_id, target_entity_id
       FROM relations
       WHERE repo_id = ? AND index_run_id = ? AND source_entity_id = ? AND target_entity_id = ?`
    );
    const promoteRelation = db.prepare(`UPDATE relations SET confidence = 'proven' WHERE id = ?`);
    const insertEvidence = db.prepare(
      `INSERT OR IGNORE INTO relation_evidence
         (id, relation_id, repo_id, file_path, kind, snippet, confidence, index_run_id,
          start_line, end_line, start_col, end_col)
       VALUES (?, ?, ?, ?, ?, ?, 'proven', ?, NULL, NULL, NULL, NULL)`
    );

    return {
      relations: (edge) => selectRelations.all(repoId, indexRunId, `file:${edge.source}`, `file:${edge.target}`) as Array<{ id: string; kind: string; confidence: string }>,
      promote(edge, row) {
        promoteRelation.run(row.id);
        insertEvidence.run(traceEvidenceId(row.id), row.id, repoId, edge.source, row.kind, `confirmed by runtime trace: ${edge.source} -> ${edge.target}`, indexRunId);
      },
      close: () => db.close()
    };
  } catch (error) { db.close(); throw error; }
}
export { parseTraceInput } from "../../domain/impact/traces.js";
export type { ObservedEdge,TraceIngestSummary } from "../../domain/impact/traces.js";
