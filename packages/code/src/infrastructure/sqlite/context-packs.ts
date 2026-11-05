import type { ContextPackWrite } from "../../application/context/pack-ports.js";
import type { McpContext } from "../../application/context/request.js";
import { sanitizeTelemetryPaths } from "../../domain/context/telemetry.js";
import { withReadOnlyDb } from "./context-resources.js";
import { withWritableDb } from "./context-telemetry.js";

export function indexRunAsOfIso(context: McpContext, indexRunId: number): string {
  return withReadOnlyDb(context, (db, repoId) => {
    const row = db
      .prepare('SELECT started_at, finished_at FROM index_runs WHERE repo_id = ? AND id = ?')
      .get(repoId, indexRunId) as { started_at: string; finished_at: string | null } | undefined;
    return row?.finished_at ?? row?.started_at ?? '';
  });
}
export function saveContextPack(root: string, input: ContextPackWrite): boolean {
  const context = { repoRoot: root };
  const { contextPackId, pack, request, requestHash, hash, packJson, fullBytes, resourceCount } = input;
  return withWritableDb(context, (db, repoId) => {
    const now = new Date().toISOString();
    const result = db
      .prepare(`
        INSERT OR IGNORE INTO context_packs (
          id, repo_id, index_run_id, budget, request_hash, changed_files_json,
          content_hash, pack_json, returned_bytes, resource_count, omitted_json,
          created_at, last_accessed_at, hit_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .run(
        contextPackId,
        repoId,
        pack.indexRunId,
        pack.budget,
        requestHash,
        JSON.stringify(sanitizeTelemetryPaths(request.changedFiles)),
        hash,
        packJson,
        fullBytes,
        resourceCount,
        JSON.stringify(pack.omittedCounts),
        now,
        now
      ) as { changes?: number };
    if ((result.changes ?? 0) > 0) return false;
    db
      .prepare(`
        UPDATE context_packs
           SET last_accessed_at = ?,
               hit_count = hit_count + 1
         WHERE repo_id = ? AND id = ?
      `)
      .run(now, repoId, contextPackId);
    return true;
  }, { skipProjectionRepair: true });
}
