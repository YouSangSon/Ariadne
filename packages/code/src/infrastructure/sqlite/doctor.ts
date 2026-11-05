import type { DoctorSession } from "../../application/indexing/doctor-ports.js";
import type { IndexRunColumnState } from "../../domain/indexing/diagnostics-state.js";
import type { DoctorAdapterRun, DoctorCoverage, DoctorIndexRun, DoctorReport, DoctorTableState } from "../../domain/indexing/diagnostics.js";
import { CURRENT_SCHEMA_VERSION, isVectorExtensionLoaded, openDatabase, vecTableName } from "./store.js";
import type { Db } from "./store.js";

export const REQUIRED_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

function readTableState(db: Db): DoctorTableState {
  return {
    schemaVersions: tableExists(db, 'schema_versions'),
    repos: tableExists(db, 'repos'),
    indexRuns: tableExists(db, 'index_runs'),
    adapterRuns: tableExists(db, 'adapter_runs'),
    indexCoverage: tableExists(db, 'index_coverage'),
    factEmbeddings: tableExists(db, 'fact_embeddings'),
    contextToolRuns: tableExists(db, 'context_tool_runs'),
    contextResourceAccesses: tableExists(db, 'context_resource_accesses'),
    contextPacks: tableExists(db, 'context_packs')
  };
}

function tableExists(db: Db, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { one: number } | undefined;
  return row !== undefined;
}

function tableColumns(db: Db, tableName: string): Set<string> {
  const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all(tableName) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function hasColumns(db: Db, tableName: string, columns: string[]): boolean {
  const available = tableColumns(db, tableName);
  return columns.every((column) => available.has(column));
}

function readSchemaVersion(db: Db, tables: DoctorTableState): number | null {
  if (!tables.schemaVersions) return null;
  const row = db.prepare('SELECT max(version) AS version FROM schema_versions').get() as { version: number | null };
  return row.version;
}

function readRepoId(db: Db, repoRoot: string): number | null {
  const row = db.prepare('SELECT id FROM repos WHERE root = ?').get(repoRoot) as { id: number } | undefined;
  return row?.id ?? null;
}

function readIndexRunColumnState(db: Db): IndexRunColumnState {
  const columns = tableColumns(db, 'index_runs');
  return {
    gitCommitSha: columns.has('git_commit_sha'),
    gitBranchName: columns.has('git_branch_name'),
    gitIsDirty: columns.has('git_is_dirty')
  };
}

function readLatestIndexRun(
  db: Db,
  repoId: number,
  completedOnly: boolean,
  columns: IndexRunColumnState
): DoctorIndexRun | null {
  const statusClause = completedOnly ? 'AND status = ?' : '';
  const params = completedOnly ? [repoId, 'completed'] : [repoId];
  const gitCommitShaSelect = columns.gitCommitSha ? 'git_commit_sha AS gitCommitSha' : 'NULL AS gitCommitSha';
  const gitBranchNameSelect = columns.gitBranchName ? 'git_branch_name AS gitBranchName' : 'NULL AS gitBranchName';
  const gitIsDirtySelect = columns.gitIsDirty ? 'git_is_dirty AS gitIsDirty' : 'NULL AS gitIsDirty';
  const row = db
    .prepare(
      `SELECT id, status, started_at AS startedAt, finished_at AS finishedAt,
              extractor_version AS extractorVersion, ${gitCommitShaSelect},
              ${gitBranchNameSelect}, ${gitIsDirtySelect}
         FROM index_runs
        WHERE repo_id = ? ${statusClause}
        ORDER BY id DESC
        LIMIT 1`
    )
    .get(...params) as
    | {
        id: number;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        extractorVersion: string | null;
        gitCommitSha: string | null;
        gitBranchName: string | null;
        gitIsDirty: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    extractorVersion: row.extractorVersion,
    gitCommitSha: row.gitCommitSha,
    gitBranchName: row.gitBranchName,
    gitIsDirty: row.gitIsDirty === null ? null : row.gitIsDirty === 1
  };
}

function readCoverage(db: Db, indexRunId: number): DoctorCoverage {
  const counts = db
    .prepare(
      `SELECT count(*) AS totalRows,
              sum(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexedPaths,
              sum(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skippedPaths
         FROM index_coverage
        WHERE index_run_id = ?`
    )
    .get(indexRunId) as { totalRows: number; indexedPaths: number | null; skippedPaths: number | null };
  const unsupportedLanguageIds = db
    .prepare(
      `SELECT DISTINCT language_id AS languageId
         FROM index_coverage
        WHERE index_run_id = ? AND status = 'skipped' AND language_id IS NOT NULL
        ORDER BY language_id`
    )
    .all(indexRunId) as Array<{ languageId: string }>;
  return {
    totalRows: counts.totalRows,
    indexedPaths: counts.indexedPaths ?? 0,
    skippedPaths: counts.skippedPaths ?? 0,
    unsupportedLanguageIds: unsupportedLanguageIds.map((row) => row.languageId)
  };
}

function readAdapterRuns(db: Db, indexRunId: number): DoctorAdapterRun[] {
  if (hasColumns(db, 'adapter_runs', ['confidence', 'known_gaps_json'])) {
    const rows = db
      .prepare(
        `SELECT adapter_id AS adapterId,
                status,
                confidence,
                known_gaps_json AS knownGapsJson,
                count(*) AS count
           FROM adapter_runs
          WHERE index_run_id = ?
          GROUP BY adapter_id, status, confidence, known_gaps_json
          ORDER BY adapter_id, status`
      )
      .all(indexRunId) as Array<{
        adapterId: string;
        status: string;
        confidence: string;
        knownGapsJson: string;
        count: number;
      }>;
    return rows.map((row) => ({
      adapterId: row.adapterId,
      status: row.status,
      confidence: row.confidence,
      knownGaps: parseStringArray(row.knownGapsJson),
      count: row.count
    }));
  }
  const rows = db
    .prepare(
      `SELECT adapter_id AS adapterId, status, count(*) AS count
         FROM adapter_runs
        WHERE index_run_id = ?
        GROUP BY adapter_id, status
        ORDER BY adapter_id, status`
    )
    .all(indexRunId) as Array<{ adapterId: string; status: string; count: number }>;
  return rows.map((row) => ({
    adapterId: row.adapterId,
    status: row.status,
    confidence: 'unknown',
    knownGaps: [],
    count: row.count
  }));
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function readVecTables(db: Db): string[] {
  return db
    .prepare(
      `SELECT name
         FROM sqlite_master
        WHERE name GLOB ? AND sql LIKE '%USING vec0%'
        ORDER BY name`
    )
    .all(`${vecTableName('')}*`)
    .map((row) => (row as { name: string }).name);
}

function readCount(db: Db, sql: string): number {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

function readEmbeddingModels(db: Db): Array<{ model: string; rows: number; dim: number }> {
  return db
    .prepare(
      `SELECT model, count(*) AS rows, max(dim) AS dim
         FROM fact_embeddings
        GROUP BY model
        ORDER BY rows DESC, model`
    )
    .all() as Array<{ model: string; rows: number; dim: number }>;
}

function readTelemetry(db: Db): DoctorReport['telemetry'] {
  const toolRows = db
    .prepare('SELECT count(*) AS count, max(finished_at) AS latestAt FROM context_tool_runs')
    .get() as { count: number; latestAt: string | null };
  const resourceRows = db
    .prepare('SELECT count(*) AS count, max(accessed_at) AS latestAt FROM context_resource_accesses')
    .get() as { count: number; latestAt: string | null };
  return {
    toolRuns: toolRows.count,
    resourceAccesses: resourceRows.count,
    latestToolRunAt: toolRows.latestAt,
    latestResourceAccessAt: resourceRows.latestAt
  };
}

function canReadTelemetry(db: Db): boolean {
  return hasColumns(db, 'context_tool_runs', ['finished_at']) &&
    hasColumns(db, 'context_resource_accesses', ['accessed_at']);
}
export { hasDoctorErrors,redactDoctorReportForMcp } from "../../domain/indexing/diagnostics.js";
export type { DoctorAdapterRun,DoctorCoverage,DoctorFinding,DoctorFindingSeverity,DoctorIndexRun,DoctorOptions,DoctorReport,DoctorTableState } from "../../domain/indexing/diagnostics.js";

export function openDoctorSession(root: string): DoctorSession {
  const db = openDatabase(root, { readOnly: true });
  return {
    tables: () => readTableState(db),
    schemaVersion: (tables) => readSchemaVersion(db, tables),
    vectorLoaded: () => isVectorExtensionLoaded(db),
    vecTables: () => readVecTables(db),
    factEmbeddingRows: () => readCount(db, 'SELECT count(*) AS count FROM fact_embeddings'),
    embeddingModels: () => readEmbeddingModels(db),
    repoId: () => readRepoId(db, root),
    indexRunColumns: () => readIndexRunColumnState(db),
    latestIndexRun: (repoId, completed, columns) => readLatestIndexRun(db, repoId, completed, columns),
    coverage: (id) => readCoverage(db, id),
    adapterRuns: (id) => readAdapterRuns(db, id),
    canReadTelemetry: () => canReadTelemetry(db),
    telemetry: () => readTelemetry(db),
    close: () => db.close()
  };
}