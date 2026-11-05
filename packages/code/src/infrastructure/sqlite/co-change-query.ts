import type { CoChangeRow } from "../../domain/context/co-change.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

export function readCoChangeRows(repoRoot: string, target: string): { indexRunId: number; rows: CoChangeRow[] } {
  const root = normalizeRepoRoot(repoRoot);
  const db = openDatabase(root, { readOnly: true });
  try {
    const repoId = getRepoId(db, root);
    const indexRunId = latestCompletedIndexRun(db, repoId);
    const rows = db
      .prepare(
        `SELECT tgt.path AS path, r.provenance AS provenance, r.confidence AS confidence
         FROM relations r
         JOIN entities src ON src.id = r.source_entity_id
         JOIN entities tgt ON tgt.id = r.target_entity_id
         WHERE r.repo_id = ? AND r.index_run_id = ? AND r.kind = 'CO_CHANGES' AND src.path = ?`
      )
      .all(repoId, indexRunId, target) as Array<{
      path: string;
      provenance: string;
      confidence: string;
    }>;

    return { indexRunId, rows };
  } finally {
    db.close();
  }
}
export type { CoChangePartner,CoChangeQueryOptions,CoChangeQueryResult } from "../../domain/context/co-change.js";
