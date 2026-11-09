import path from "node:path";
import { parseTrustPolicy, stableStringify } from "../../domain/workspace/catalog.js";
import type { ListWorkspacesResult, ResolvedCatalogRepo, WorkspaceCatalog, WorkspaceRepoSummary, WorkspaceSummary } from "../../domain/workspace/catalog.js";
import { ensureRepo, openDatabase } from "./store.js";

export function listWorkspacesFromDatabase(repoRoot: string, name?: string): ListWorkspacesResult {
  const db = openDatabase(repoRoot, { readOnly: true });
  try {
    const workspaces = db
      .prepare(
        `SELECT id, name
         FROM workspaces
         ${name === undefined ? '' : 'WHERE name = ?'}
         ORDER BY name`
      )
      .all(...(name === undefined ? [] : [name])) as Array<{ id: number; name: string }>;

    return {
      workspaces: workspaces.map((workspace) => ({
        name: workspace.name,
        repos: readWorkspaceRepos(db, workspace.id)
      }))
    };
  } finally {
    db.close();
  }
}

export function readWorkspace(repoRoot: string, name: string): WorkspaceSummary {
  const listed = listWorkspacesFromDatabase(repoRoot, name);
  const workspace = listed.workspaces[0];
  if (!workspace) {
    throw new Error(`workspace not found after sync: ${name}`);
  }
  return workspace;
}

export function readWorkspaceRepos(db: ReturnType<typeof openDatabase>, workspaceId: number): WorkspaceRepoSummary[] {
  const rows = db
    .prepare(
      `SELECT local_path, service_name, remote_url, trust_policy_json
       FROM workspace_repos
       WHERE workspace_id = ?
       ORDER BY local_path`
    )
    .all(workspaceId) as Array<{
      local_path: string;
      service_name: string | null;
      remote_url: string | null;
      trust_policy_json: string;
    }>;
  return rows.map((row) => ({
    localPath: row.local_path,
    serviceName: row.service_name ?? path.basename(row.local_path),
    remoteUrl: row.remote_url,
    trustPolicy: parseTrustPolicy(row.trust_policy_json)
  }));
}

export function getWorkspaceId(db: ReturnType<typeof openDatabase>, name: string): number {
  const row = db.prepare('SELECT id FROM workspaces WHERE name = ?').get(name) as { id: number } | undefined;
  if (!row) {
    throw new Error(`workspace not found: ${name}`);
  }
  return row.id;
}

export function upsertDefaultWorkspace(db: ReturnType<typeof openDatabase>, name: string, configJson: string): number {
  const existingRows = db
    .prepare('SELECT id, name FROM workspaces ORDER BY id')
    .all() as Array<{ id: number; name: string }>;
  const named = existingRows.find((row) => row.name === name);
  let workspaceId: number;

  if (named) {
    workspaceId = named.id;
    db.prepare('UPDATE workspaces SET config_json = ? WHERE id = ?').run(configJson, workspaceId);
  } else if (existingRows.length === 1) {
    workspaceId = existingRows[0]!.id;
    db.prepare('UPDATE workspaces SET name = ?, config_json = ? WHERE id = ?').run(name, configJson, workspaceId);
  } else {
    db.prepare(
      `INSERT INTO workspaces (name, config_json, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(name, configJson);
    workspaceId = getWorkspaceId(db, name);
  }

  db.prepare('DELETE FROM workspace_repos WHERE workspace_id <> ?').run(workspaceId);
  db.prepare('DELETE FROM workspaces WHERE id <> ?').run(workspaceId);
  return workspaceId;
}

export function pruneWorkspaceRepos(db: ReturnType<typeof openDatabase>, workspaceId: number, keepPaths: string[]): void {
  if (keepPaths.length === 0) {
    db.prepare('DELETE FROM workspace_repos WHERE workspace_id = ?').run(workspaceId);
    return;
  }
  const placeholders = keepPaths.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM workspace_repos
     WHERE workspace_id = ? AND local_path NOT IN (${placeholders})`
  ).run(workspaceId, ...keepPaths);
}
export function persistWorkspaceCatalog(repoRoot: string, catalog: WorkspaceCatalog, resolvedRepos: ResolvedCatalogRepo[]): void {
  const db = openDatabase(repoRoot);
  try {
    db.exec('BEGIN');
    try {
      const workspaceId = upsertDefaultWorkspace(db, catalog.name, stableStringify(catalog));

      const keepPaths: string[] = [];
      for (const repo of resolvedRepos) {
        const repoId = ensureRepo(db, repo.localPath);
        keepPaths.push(repo.localPath);
        db.prepare(
          `INSERT INTO workspace_repos (
             workspace_id, repo_id, local_path, remote_url, service_name, trust_policy_json, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(workspace_id, local_path) DO UPDATE SET
             repo_id = excluded.repo_id,
             remote_url = excluded.remote_url,
             service_name = excluded.service_name,
             trust_policy_json = excluded.trust_policy_json`
        ).run(
          workspaceId,
          repoId,
          repo.localPath,
          repo.remoteUrl,
          repo.serviceName,
          stableStringify(repo.trustPolicy)
        );
      }

      pruneWorkspaceRepos(db, workspaceId, keepPaths);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }

}