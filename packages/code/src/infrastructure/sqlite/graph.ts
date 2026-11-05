import type { GraphSession } from "../../application/impact/export-graph.js";
import type { CanonicalGraphRow, LegacyGraphRow, ReportRow } from "../../domain/impact/graph.js";
import type { ImpactReport } from "../../domain/model.js";
import { getRepoId, openDatabase } from "./store.js";

function loadCanonicalRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  scopeEntityIds: string[]
): CanonicalGraphRow[] {
  if (scopeEntityIds.length === 0) return [];
  const placeholders = scopeEntityIds.map(() => '?').join(', ');
  return db
    .prepare(`
      SELECT
        r.id AS relation_id,
        r.kind AS relation_kind,
        r.confidence AS confidence,
        source.id AS source_id,
        source.kind AS source_kind,
        source.path AS source_path,
        source.display_name AS source_display_name,
        target.id AS target_id,
        target.kind AS target_kind,
        target.path AS target_path,
        target.display_name AS target_display_name
      FROM relations r
      JOIN entities source ON source.id = r.source_entity_id
      JOIN entities target ON target.id = r.target_entity_id
      WHERE r.repo_id = ?
        AND r.index_run_id = ?
        AND r.target_entity_id IN (${placeholders})
        AND r.source_entity_id IN (${placeholders})
        AND source.path IS NOT NULL
      ORDER BY source.display_name, target.display_name, r.kind
    `)
    .all(repoId, indexRunId, ...scopeEntityIds, ...scopeEntityIds) as CanonicalGraphRow[];
}

function loadLegacyRows(
  db: ReturnType<typeof openDatabase>,
  repoId: number,
  indexRunId: number,
  changedFiles: string[]
): LegacyGraphRow[] {
  if (changedFiles.length === 0) return [];
  const placeholders = changedFiles.map(() => '?').join(', ');
  return db
    .prepare(`
      SELECT
        e.id AS edge_id,
        e.kind AS kind,
        e.confidence AS confidence,
        f.path AS source_path,
        e.target_path AS target_path
      FROM edges e
      JOIN files f ON f.id = e.source_file_id
      WHERE e.repo_id = ?
        AND e.index_run_id = ?
        AND e.target_path IN (${placeholders})
      ORDER BY f.path, e.target_path, e.kind
    `)
    .all(repoId, indexRunId, ...changedFiles) as LegacyGraphRow[];
}

export function openGraphSession(root: string): GraphSession {
  const db = openDatabase(root, { readOnly: true });
  try {
    const repoId = getRepoId(db, root);
    return {
      report(id) {
        const row = db.prepare('SELECT id, index_run_id, json FROM reports WHERE repo_id = ? AND id = ?').get(repoId, id) as ReportRow | undefined;
        return row ? JSON.parse(row.json) as ImpactReport : null;
      },
      canonicalRows: (runId, ids) => loadCanonicalRows(db, repoId, runId, ids),
      legacyRows: (runId, changed) => loadLegacyRows(db, repoId, runId, changed),
      close: () => db.close()
    };
  } catch (error) { db.close(); throw error; }
}