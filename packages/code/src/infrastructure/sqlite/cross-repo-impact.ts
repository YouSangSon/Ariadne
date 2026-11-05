import path from "node:path";
import { projectCrossRepoImpacts } from "../../domain/workspace/cross-repo-impact-policy.js";
import type { BreakLinkRow, ContractRow } from "../../domain/workspace/cross-repo-impact-policy.js";
import type { CrossRepoImpactLoadResult } from "../../domain/workspace/cross-repo-impact.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { openDatabase } from "./store.js";

export type CrossRepoImpactLoadOptions = {
  db: ReturnType<typeof openDatabase>;
  repoRoot: string;
  repoId: number;
  indexRunId: number;
  changedFile: string;
};

export function loadCrossRepoImpactsForChangedContract(
  options: CrossRepoImpactLoadOptions
): CrossRepoImpactLoadResult {
  const { db, repoRoot, repoId, indexRunId, changedFile } = options;
  if (!hasTables(db, ['contracts', 'contract_versions', 'cross_repo_links', 'workspaces'])) {
    return { candidates: [], malformedLinkCount: 0 };
  }

  const contract = db
    .prepare(
      `SELECT c.service_name
         FROM contracts c
         INNER JOIN contract_versions v ON v.contract_id = c.id
        WHERE c.repo_id = ?
          AND c.path = ?
          AND v.index_run_id = ?
        LIMIT 1`
    )
    .get(repoId, changedFile, indexRunId) as ContractRow | undefined;
  if (!contract) return { candidates: [], malformedLinkCount: 0 };

  const rows = db
    .prepare(
      `SELECT link.id, workspace.name AS workspace_name, link.confidence, link.provenance
         FROM cross_repo_links link
         LEFT JOIN workspaces workspace ON workspace.id = link.workspace_id
        WHERE link.target_repo_id = ?
          AND link.kind = 'BREAKS_COMPATIBILITY_WITH'
        ORDER BY link.id`
    )
    .all(repoId) as BreakLinkRow[];

  return projectCrossRepoImpacts({ rows, contract, repoRoot, changedFile, indexRunId }, providerRepoMatches);

}

function hasTables(db: ReturnType<typeof openDatabase>, tables: string[]): boolean {
  return tables.every((table) =>
    db
      .prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
}

function providerRepoMatches(providerRepoPath: string | undefined, repoRoot: string): boolean {
  if (!providerRepoPath) return true;
  try {
    return normalizeRepoRoot(providerRepoPath) === repoRoot;
  } catch {
    return path.resolve(providerRepoPath) === repoRoot;
  }
}
export type { CrossRepoImpactCandidate,CrossRepoImpactLoadResult } from "../../domain/workspace/cross-repo-impact.js";
