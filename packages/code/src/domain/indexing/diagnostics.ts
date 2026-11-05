import { DATA_DIR, PACKAGE_NAME } from "../branding.js";

export type DoctorOptions = {
  repoRoot: string;
};

export type DoctorFindingSeverity = 'info' | 'warn' | 'error';

export type DoctorFinding = {
  severity: DoctorFindingSeverity;
  code: string;
  message: string;
  fix?: string;
};

export type DoctorTableState = {
  schemaVersions: boolean;
  repos: boolean;
  indexRuns: boolean;
  adapterRuns: boolean;
  indexCoverage: boolean;
  factEmbeddings: boolean;
  contextToolRuns: boolean;
  contextResourceAccesses: boolean;
  contextPacks: boolean;
};

export type DoctorIndexRun = {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  extractorVersion: string | null;
  gitCommitSha: string | null;
  gitBranchName: string | null;
  gitIsDirty: boolean | null;
};

export type DoctorCoverage = {
  totalRows: number;
  indexedPaths: number;
  skippedPaths: number;
  unsupportedLanguageIds: string[];
};

export type DoctorAdapterRun = {
  adapterId: string;
  status: string;
  confidence: string;
  knownGaps: string[];
  count: number;
};

export type DoctorReport = {
  version: 0;
  generatedAt: string;
  repoRoot: string;
  database: {
    path: string;
    exists: boolean;
    schemaVersion: number | null;
    requiredSchemaVersion: number;
    tables: DoctorTableState;
    telemetryTables: boolean;
    error: string | null;
  };
  index: {
    latestRun: DoctorIndexRun | null;
    latestCompletedRun: DoctorIndexRun | null;
    coverage: DoctorCoverage | null;
    adapterRuns: DoctorAdapterRun[];
  };
  vector: {
    sqliteVecLoaded: boolean | null;
    vecTables: string[];
    factEmbeddingRows: number | null;
    models: Array<{ model: string; rows: number; dim: number }>;
  };
  telemetry: {
    toolRuns: number | null;
    resourceAccesses: number | null;
    latestToolRunAt: string | null;
    latestResourceAccessAt: string | null;
  };
  findings: DoctorFinding[];
};

export function addSchemaFindings(report: DoctorReport): void {
  if (report.database.schemaVersion === null) {
    report.findings.push({
      severity: 'error',
      code: 'schema_missing',
      message: 'Database schema version table is missing or empty.',
      fix: `Back up ${DATA_DIR}, then rerun ${PACKAGE_NAME} init.`
    });
    return;
  }
  if (report.database.schemaVersion < report.database.requiredSchemaVersion) {
    report.findings.push({
      severity: 'error',
      code: 'schema_outdated',
      message: `Database schema is v${report.database.schemaVersion}; this build expects v${report.database.requiredSchemaVersion}.`,
      fix: `Run ${PACKAGE_NAME} init with the current build to apply additive migrations.`
    });
  }
  if (!report.database.telemetryTables) {
    report.findings.push({
      severity: report.database.schemaVersion >= report.database.requiredSchemaVersion ? 'error' : 'warn',
      code: 'telemetry_tables_missing',
      message: 'Context telemetry tables are not available.',
      fix: `Run ${PACKAGE_NAME} init with the current build.`
    });
  }
}

export function addIndexFindings(report: DoctorReport): void {
  if (!report.index.latestCompletedRun) {
    report.findings.push({
      severity: 'warn',
      code: 'index_missing',
      message: 'No completed index run exists for this repository.',
      fix: `Run ${PACKAGE_NAME} index before asking agents for impact context.`
    });
  }
  if (report.index.latestRun && report.index.latestRun.status !== 'completed') {
    report.findings.push({
      severity: report.index.latestRun.status === 'failed' ? 'error' : 'warn',
      code: 'latest_index_not_completed',
      message: `Latest index run ${report.index.latestRun.id} ended with status '${report.index.latestRun.status}'.`,
      fix: `Inspect adapter diagnostics and rerun ${PACKAGE_NAME} index.`
    });
  }
  if (report.index.latestCompletedRun?.gitIsDirty) {
    report.findings.push({
      severity: 'warn',
      code: 'index_created_from_dirty_tree',
      message: 'Latest completed index was created while the git working tree was dirty.',
      fix: `Re-run ${PACKAGE_NAME} index after committing or stashing unrelated changes.`
    });
  }
}

export function addCoverageFindings(report: DoctorReport): void {
  const skippedPaths = report.index.coverage?.skippedPaths ?? 0;
  if (skippedPaths > 0) {
    report.findings.push({
      severity: 'warn',
      code: 'coverage_skipped_paths',
      message: `${skippedPaths} path(s) were skipped by the latest completed index.`,
      fix: 'Inspect parallax://coverage/latest or rerun index with a higher --max-file-bytes limit if appropriate.'
    });
  }
}

export function hasDoctorErrors(report: DoctorReport): boolean {
  return report.findings.some((finding) => finding.severity === 'error');
}

export function redactDoctorReportForMcp(report: DoctorReport): DoctorReport {
  return {
    ...report,
    repoRoot: '[REPO_ROOT]',
    database: {
      ...report.database,
      path: `${DATA_DIR}/impact.db`
    }
  };
}