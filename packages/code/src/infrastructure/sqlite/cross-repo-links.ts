import { parseLinkRow } from "../../domain/workspace/links.js";
import type { CrossRepoDiagnostic, CrossRepoLinkRecord, CrossRepoLinkRow } from "../../domain/workspace/links.js";
import { openDatabase } from "./store.js";

function loadWorkspaceLinkRecords(db: ReturnType<typeof openDatabase>, workspaceName: string): {
  rowsSeen: number;
  records: CrossRepoLinkRecord[];
  malformed: CrossRepoDiagnostic[];
} {
  const rows = db
    .prepare(
      `SELECT
         link.id, link.kind, link.confidence, link.provenance,
         workspace.name AS workspace_name,
         source_repo.root AS source_repo_root,
         target_repo.root AS target_repo_root,
         source_member.local_path AS source_member_path,
         source_member.service_name AS source_service_name,
         target_member.local_path AS target_member_path,
         target_member.service_name AS target_service_name
       FROM cross_repo_links link
       LEFT JOIN workspaces workspace ON workspace.id = link.workspace_id
       LEFT JOIN repos source_repo ON source_repo.id = link.source_repo_id
       LEFT JOIN repos target_repo ON target_repo.id = link.target_repo_id
       LEFT JOIN workspace_repos source_member
         ON source_member.workspace_id = link.workspace_id
        AND source_member.repo_id = link.source_repo_id
       LEFT JOIN workspace_repos target_member
         ON target_member.workspace_id = link.workspace_id
        AND target_member.repo_id = link.target_repo_id
       WHERE workspace.name = ?
       ORDER BY link.kind, link.id`
    )
    .all(workspaceName) as CrossRepoLinkRow[];

  const records: CrossRepoLinkRecord[] = [];
  const malformed: CrossRepoDiagnostic[] = [];
  for (const row of rows) {
    const parsed = parseLinkRow(row, workspaceName);
    if ('diagnostic' in parsed) {
      malformed.push(parsed.diagnostic);
    } else {
      records.push(parsed.record);
    }
  }
  return { rowsSeen: rows.length, records, malformed };
}
export type { CrossRepoConsumer,CrossRepoConsumersOptions,CrossRepoConsumersResult,CrossRepoDiagnostic,CrossRepoDiagnosticKind,CrossRepoEndpoint,CrossRepoLinkKind,CrossRepoLinkRecord,CrossRepoLinkVerifyOptions,CrossRepoLinkVerifyResult,CrossRepoProvider,CrossRepoProvidersOptions,CrossRepoProvidersResult } from "../../domain/workspace/links.js";

export function readWorkspaceLinks(root: string, name: string) {
  const db = openDatabase(root, { readOnly: true });
  try { return loadWorkspaceLinkRecords(db, name); } finally { db.close(); }
}