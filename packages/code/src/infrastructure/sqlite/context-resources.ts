import type { McpContext } from "../../application/context/request.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { getRepoId, openDatabase } from "./store.js";

export function evidenceSpanColumnSelect(db: ReturnType<typeof openDatabase>, alias: string): string {
  if (!mcpHasColumn(db, 'relation_evidence', 'start_line')) {
    return [
      'NULL AS evidence_start_line',
      'NULL AS evidence_end_line',
      'NULL AS evidence_start_col',
      'NULL AS evidence_end_col'
    ].join(',\n          ');
  }
  return [
    `${alias}.start_line AS evidence_start_line`,
    `${alias}.end_line AS evidence_end_line`,
    `${alias}.start_col AS evidence_start_col`,
    `${alias}.end_col AS evidence_end_col`
  ].join(',\n          ');
}

export function mcpHasColumn(db: ReturnType<typeof openDatabase>, table: string, column: string): boolean {
  return db
    .prepare('SELECT 1 AS one FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column) !== undefined;
}

export function mcpHasTable(db: ReturnType<typeof openDatabase>, table: string): boolean {
  return db
    .prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) !== undefined;
}

export function withReadOnlyDb<T>(context: McpContext, callback: (db: ReturnType<typeof openDatabase>, repoId: number) => T): T {
  const repoRoot = normalizeRepoRoot(context.repoRoot);
  const db = openDatabase(repoRoot, { readOnly: true });
  try {
    const repoId = getRepoId(db, repoRoot);
    return callback(db, repoId);
  } finally {
    db.close();
  }
}
export { errorMessage,parseTypedMcpError,typedMcpError,typedMcpErrorEnvelope } from "../../application/context/errors.js";
export type { TypedMcpErrorEnvelope } from "../../application/context/errors.js";
export { byteLength,compactEvidenceResource,isRecord,parseJsonObject } from "../../domain/context/evidence.js";
export type { CompactEvidenceResource,ExplainEvidenceRow } from "../../domain/context/evidence.js";
