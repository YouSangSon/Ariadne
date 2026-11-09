import { randomUUID } from "node:crypto";
import type { McpContext } from "../../application/context/request.js";
import { parseJsonObject } from "../../domain/context/evidence.js";
import { emptyContextTelemetry, parseJsonArray, sanitizeTelemetryPaths, sanitizeTelemetryText } from "../../domain/context/telemetry.js";
import type { ResourceTelemetryInput, ToolTelemetryInput } from "../../domain/context/telemetry.js";
import { envValue } from "../config/branding.js";
import { normalizeRepoRoot } from "../filesystem/security.js";
import { mcpHasTable, withReadOnlyDb } from "./context-resources.js";
import { getRepoId, openDatabase } from "./store.js";

export function recordContextToolRun(
  context: McpContext,
  input: ToolTelemetryInput & {
    toolName: string;
    returnedBytes: number;
    resourceCount: number;
    omitted: unknown;
  }
): void {
  bestEffortTelemetry(() => withWritableDb(context, (db, repoId) => {
    const now = new Date().toISOString();
    db
      .prepare(`
        INSERT INTO context_tool_runs (
          id, repo_id, tool_name, index_run_id, budget, query, changed_files_json,
          returned_bytes, resource_count, omitted_json, started_at, finished_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        repoId,
        input.toolName,
        input.indexRunId ?? null,
        input.budget ?? null,
        input.query ?? null,
        JSON.stringify(sanitizeTelemetryPaths(input.changedFiles ?? [])),
        input.returnedBytes,
        input.resourceCount,
        JSON.stringify(input.omitted ?? {}),
        now,
        now
      );
  }, { skipProjectionRepair: true }));
}

export function recordContextResourceAccess(context: McpContext, input: ResourceTelemetryInput): void {
  bestEffortTelemetry(() => withWritableDb(context, (db, repoId) => {
    db
      .prepare(`
        INSERT INTO context_resource_accesses (
          id, repo_id, uri, resource_kind, resource_id, index_run_id, returned_bytes, accessed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        repoId,
        sanitizeTelemetryText(input.uri) ?? input.uri,
        input.resourceKind,
        sanitizeTelemetryText(input.resourceId),
        input.indexRunId ?? null,
        input.returnedBytes,
        new Date().toISOString()
      );
  }, { skipProjectionRepair: true }));
}

export function contextTelemetry(context: McpContext, limit: number): unknown {
  return withReadOnlyDb(context, (db, repoId) => {
    if (!hasContextTelemetryTables(db)) {
      return emptyContextTelemetry();
    }
    const summary = db
      .prepare(`
        SELECT
          (SELECT count(*) FROM context_tool_runs WHERE repo_id = ?) AS tool_runs,
          (SELECT count(*) FROM context_resource_accesses WHERE repo_id = ?) AS resource_accesses,
          (SELECT COALESCE(sum(returned_bytes), 0) FROM context_tool_runs WHERE repo_id = ?)
            + (SELECT COALESCE(sum(returned_bytes), 0) FROM context_resource_accesses WHERE repo_id = ?) AS returned_bytes,
          (SELECT COALESCE(sum(resource_count), 0) FROM context_tool_runs WHERE repo_id = ?) AS resources_advertised
      `)
      .get(repoId, repoId, repoId, repoId, repoId) as {
        tool_runs: number;
        resource_accesses: number;
        returned_bytes: number;
        resources_advertised: number;
      };
    const toolRows = db
      .prepare(`
        SELECT id, tool_name, index_run_id, budget, query, changed_files_json,
               returned_bytes, resource_count, omitted_json, started_at, finished_at
        FROM context_tool_runs
        WHERE repo_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT ?
      `)
      .all(repoId, limit) as Array<{
        id: string;
        tool_name: string;
        index_run_id: number | null;
        budget: string | null;
        query: string | null;
        changed_files_json: string;
        returned_bytes: number;
        resource_count: number;
        omitted_json: string;
        started_at: string;
        finished_at: string;
      }>;
    const resourceRows = db
      .prepare(`
        SELECT id, uri, resource_kind, resource_id, index_run_id, returned_bytes, accessed_at
        FROM context_resource_accesses
        WHERE repo_id = ?
        ORDER BY accessed_at DESC, id DESC
        LIMIT ?
      `)
      .all(repoId, limit) as Array<{
        id: string;
        uri: string;
        resource_kind: string;
        resource_id: string | null;
        index_run_id: number | null;
        returned_bytes: number;
        accessed_at: string;
      }>;

    return {
      version: 0,
      summary: {
        toolRuns: summary.tool_runs,
        resourceAccesses: summary.resource_accesses,
        returnedBytes: summary.returned_bytes,
        resourcesAdvertised: summary.resources_advertised
      },
      toolRuns: toolRows.map((row) => ({
        id: row.id,
        toolName: row.tool_name,
        indexRunId: row.index_run_id,
        budget: row.budget,
        query: row.query,
        changedFiles: parseJsonArray(row.changed_files_json),
        returnedBytes: row.returned_bytes,
        resourceCount: row.resource_count,
        omitted: parseJsonObject(row.omitted_json),
        startedAt: row.started_at,
        finishedAt: row.finished_at
      })),
      resourceAccesses: resourceRows.map((row) => ({
        id: row.id,
        uri: row.uri,
        resourceKind: row.resource_kind,
        resourceId: row.resource_id,
        indexRunId: row.index_run_id,
        returnedBytes: row.returned_bytes,
        accessedAt: row.accessed_at
      }))
    };
  });
}

export function hasContextTelemetryTables(db: ReturnType<typeof openDatabase>): boolean {
  return mcpHasTable(db, 'context_tool_runs') && mcpHasTable(db, 'context_resource_accesses');
}

export function bestEffortTelemetry(callback: () => void): void {
  try {
    if (envValue('TELEMETRY_FORCE_FAILURE') === '1') {
      throw new Error('forced telemetry failure');
    }
    callback();
  } catch {
    // Telemetry must never break the primary MCP result or resource read.
  }
}

export function withWritableDb<T>(
  context: McpContext,
  callback: (db: ReturnType<typeof openDatabase>, repoId: number) => T,
  options: { skipProjectionRepair?: boolean } = {}
): T {
  const repoRoot = normalizeRepoRoot(context.repoRoot);
  const db = openDatabase(repoRoot, { readOnly: false, skipProjectionRepair: options.skipProjectionRepair === true });
  try {
    const repoId = getRepoId(db, repoRoot);
    return callback(db, repoId);
  } finally {
    db.close();
  }
}