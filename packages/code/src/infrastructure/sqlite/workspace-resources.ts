import { typedMcpError } from "../../application/context/errors.js";
import type { WorkspaceContractRow, WorkspaceCrossRepoLinkRow } from "../../application/context/resource-model.js";
import type { WorkspaceRepoSummary } from "../../domain/workspace/catalog.js";
import { getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

export function readWorkspaceResourceContracts(repo: WorkspaceRepoSummary) {
  const db = openDatabase(repo.localPath, { readOnly: true });
  try {
    const repoId = getRepoId(db, repo.localPath);
    const indexRunId = latestCompletedIndexRun(db, repoId);
      const rows = db
        .prepare(`
          SELECT
            c.id,
            c.kind,
            c.service_name,
            c.path,
            v.schema_version,
            v.content_hash,
            (
              SELECT count(*)
              FROM relations r
              INNER JOIN entities target
                 ON target.id = r.target_entity_id
                AND target.repo_id = r.repo_id
              WHERE r.repo_id = c.repo_id
                AND r.index_run_id = ?
                AND r.source_entity_id = c.id
                AND r.kind = 'DECLARES'
                AND target.kind = 'endpoint'
            ) AS endpoint_count
          FROM contracts c
          INNER JOIN contract_versions v
             ON v.contract_id = c.id
            AND v.index_run_id = ?
          WHERE c.repo_id = ?
          ORDER BY COALESCE(c.service_name, ''), c.path, c.id
        `)
        .all(indexRunId, indexRunId, repoId) as WorkspaceContractRow[];
    return { rows, indexRunId };
  } finally { db.close(); }
}
export function readWorkspaceResourceLinks(root: string, workspaceName: string, limit: number) {
  const db = openDatabase(root, { readOnly: true });
  try {
    getRepoId(db, root);
    const workspace = { name: workspaceName };
    const workspaceRow = db
      .prepare('SELECT id FROM workspaces WHERE name = ?')
      .get(workspace.name) as { id: number } | undefined;
    if (!workspaceRow) throw typedMcpError(new Error(`impact workspace not found: ${workspace.name}`), 'resource_not_found');
    const rows = db
      .prepare(`
        SELECT
          link.id,
          link.kind,
          link.confidence,
          link.provenance,
          link.index_run_id,
          source_member.local_path AS source_repo_path,
          source_member.service_name AS source_service,
          target_member.local_path AS target_repo_path,
          target_member.service_name AS target_service
        FROM cross_repo_links link
        INNER JOIN workspace_repos source_member
           ON source_member.workspace_id = link.workspace_id
          AND source_member.repo_id = link.source_repo_id
        INNER JOIN workspace_repos target_member
           ON target_member.workspace_id = link.workspace_id
          AND target_member.repo_id = link.target_repo_id
        WHERE link.workspace_id = ?
        ORDER BY link.kind, source_member.service_name, target_member.service_name, link.id
        LIMIT ?
      `)
      .all(workspaceRow.id, limit + 1) as WorkspaceCrossRepoLinkRow[];

    return { rows };
  } finally { db.close(); }
}
