import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { IndexedRepoReader } from "../../application/workspace/resolver-ports.js";
import type { WorkspaceSummary } from "../../domain/workspace/catalog.js";
import { errorMessage, LINK_KIND, linkId, linkProvenance, memberRelativePath, packagePrefix, parseContractEndpointDisplay, providerContractKind, sha256, shouldScanConsumerFile, warnOnce } from "../../domain/workspace/resolution.js";
import type { EndpointRow, FileRow, PersistableLink, ProviderEndpoint, ResolvedConsumerFile, WorkspaceRow } from "../../domain/workspace/resolution.js";
import { resolveInsideRoot } from "../filesystem/security.js";
import { databasePath, ensureRepo, getRepoId, latestCompletedIndexRun, openDatabase } from "./store.js";

export type { CrossRepoEventTopology } from '../../domain/workspace/matching/types.js';
export type { CrossRepoContractLink,ResolveCrossRepoContractsOptions,ResolveCrossRepoContractsResult } from "../../domain/workspace/resolution.js";

type IndexedRepo = {
  repoPath: string;
  indexedRepoPath: string;
  packagePrefix: string;
  serviceName: string;
  db: ReturnType<typeof openDatabase>;
  repoId: number;
  indexRunId: number;
};

function openIndexedWorkspaceRepos(workspace: WorkspaceSummary, warnings: string[]): IndexedRepo[] {
  const repos: IndexedRepo[] = [];
  for (const repo of workspace.repos) {
    let db: ReturnType<typeof openDatabase> | undefined;
    try {
      const repoPath = realpathSync(repo.localPath);
      const indexedRepoPath = indexedRepoRootForMember(repoPath);
      db = openDatabase(indexedRepoPath, { readOnly: true });
      const repoId = getRepoId(db, indexedRepoPath);
      const indexRunId = latestCompletedIndexRun(db, repoId);
      repos.push({
        repoPath,
        indexedRepoPath,
        packagePrefix: packagePrefix(indexedRepoPath, repoPath),
        serviceName: repo.serviceName,
        db,
        repoId,
        indexRunId
      });
      db = undefined;
    } catch (error) {
      db?.close();
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`workspace repo skipped: ${repo.localPath}: ${detail}`);
    }
  }
  return repos;
}

function loadProviderEndpoints(repo: IndexedRepo, warnings: string[], warnedFiles: Set<string>): ProviderEndpoint[] {
  const rows = repo.db
    .prepare(
      `SELECT
         source.path AS contract_path,
         source.language_id AS contract_language_id,
         contract.kind AS contract_kind,
         target.id AS endpoint_id,
         target.display_name AS endpoint_display_name,
         files.content_hash AS content_hash
       FROM relations relation
       INNER JOIN entities source
          ON source.id = relation.source_entity_id
         AND source.repo_id = relation.repo_id
       INNER JOIN entities target
          ON target.id = relation.target_entity_id
         AND target.repo_id = relation.repo_id
       INNER JOIN files
          ON files.repo_id = relation.repo_id
         AND files.path = source.path
         AND files.index_run_id = relation.index_run_id
       LEFT JOIN contracts contract
          ON contract.repo_id = source.repo_id
         AND contract.path = source.path
       WHERE relation.repo_id = ?
         AND relation.index_run_id = ?
         AND relation.kind = 'DECLARES'
         AND source.kind = 'contract'
         AND target.kind = 'endpoint'
         AND source.path IS NOT NULL
       ORDER BY source.path, target.display_name, target.id`
    )
    .all(repo.repoId, repo.indexRunId) as EndpointRow[];

  return rows.flatMap((row) => {
    const contractPath = memberRelativePath(repo, row.contract_path);
    if (contractPath === undefined) return [];
    const content = readFreshIndexedFile(repo, row.contract_path, contractPath, row.content_hash, 'provider contract', warnings, warnedFiles);
    if (content === undefined) return [];
    const parsed = parseContractEndpointDisplay(row.endpoint_display_name, providerContractKind(row));
    if (!parsed) return [];
    return [{
      repoPath: repo.repoPath,
      serviceName: repo.serviceName,
      contractPath,
      endpointId: row.endpoint_id,
      httpMethod: parsed.method,
      routePath: parsed.path
    }];
  });
}

function loadConsumerFiles(
  repo: IndexedRepo,
  endpoint: ProviderEndpoint,
  warnings: string[],
  warnedFiles: Set<string>
): ResolvedConsumerFile[] {
  const rows = repo.db
    .prepare(
      `SELECT path, content_hash
       FROM files
       WHERE repo_id = ? AND index_run_id = ?
       ORDER BY path`
    )
    .all(repo.repoId, repo.indexRunId) as FileRow[];
  const files: ResolvedConsumerFile[] = [];
  for (const row of rows) {
    const filePath = memberRelativePath(repo, row.path);
    if (filePath === undefined) continue;
    if (!shouldScanConsumerFile(filePath, endpoint)) continue;
    const content = readFreshIndexedFile(repo, row.path, filePath, row.content_hash, 'consumer file', warnings, warnedFiles);
    if (content === undefined) continue;
    files.push({ filePath, content });
  }
  return files;
}

function readFreshIndexedFile(
  repo: IndexedRepo,
  indexedFilePath: string,
  displayFilePath: string,
  indexedHash: string,
  label: 'consumer file' | 'provider contract',
  warnings: string[],
  warnedFiles: Set<string>
): string | undefined {
  const warningKey = `${label}\0${repo.repoPath}\0${displayFilePath}`;
  let absolutePath: string;
  try {
    absolutePath = resolveInsideRoot(repo.indexedRepoPath, indexedFilePath);
  } catch (error) {
    warnOnce(warnings, warnedFiles, warningKey, `${label} skipped: ${repo.serviceName}:${displayFilePath}: ${errorMessage(error)}`);
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    warnOnce(warnings, warnedFiles, warningKey, `${label} skipped: ${repo.serviceName}:${displayFilePath}: ${errorMessage(error)}`);
    return undefined;
  }

  if (sha256(content) !== indexedHash) {
    warnOnce(
      warnings,
      warnedFiles,
      warningKey,
      `stale index: ${repo.serviceName}:${displayFilePath} differs from latest completed index run ${repo.indexRunId}`
    );
    return undefined;
  }

  return content;
}

function indexedRepoRootForMember(memberPath: string): string {
  let current = memberPath;
  while (true) {
    if (existsSync(databasePath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) return memberPath;
    current = parent;
  }
}

export function persistCrossRepoLinks(repoRoot: string, workspaceName: string, links: PersistableLink[]): void {
  const db = openDatabase(repoRoot);
  try {
    const workspace = db
      .prepare('SELECT id, name FROM workspaces WHERE name = ?')
      .get(workspaceName) as WorkspaceRow | undefined;
    if (!workspace) {
      throw new Error(`workspace not found after sync: ${workspaceName}`);
    }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM cross_repo_links WHERE workspace_id = ? AND kind = ?')
        .run(workspace.id, LINK_KIND);
      const insert = db.prepare(
        `INSERT OR REPLACE INTO cross_repo_links (
           id, workspace_id, source_repo_id, target_repo_id, source_entity_id,
           target_entity_id, kind, confidence, provenance, index_run_id
         )
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`
      );
      for (const link of links) {
        const sourceRepoId = ensureRepo(db, link.consumerRepoPath);
        const targetRepoId = ensureRepo(db, link.providerRepoPath);
        insert.run(
          linkId(workspace.id, link),
          workspace.id,
          sourceRepoId,
          targetRepoId,
          link.kind,
          link.confidence,
          linkProvenance(link)
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function openIndexedWorkspaceReaders(workspace: WorkspaceSummary, warnings: string[]): IndexedRepoReader[] {
  return openIndexedWorkspaceRepos(workspace, warnings).map((repo) => {
    const { db: _db, ...info } = repo;
    return {
      info,
      providerEndpoints: (warnings, warnedFiles) => loadProviderEndpoints(repo, warnings, warnedFiles),
      consumerFiles: (endpoint, warnings, warnedFiles) => loadConsumerFiles(repo, endpoint, warnings, warnedFiles),
      close: () => repo.db.close()
    };
  });
}