import type { DoctorReport, DoctorTableState } from "./diagnostics.js";

export type IndexRunColumnState = {
  gitCommitSha: boolean;
  gitBranchName: boolean;
  gitIsDirty: boolean;
};

export function baseReport(repoRoot: string, dbPath: string, exists: boolean, requiredSchemaVersion: number, generatedAt: string): DoctorReport {
  return {
    version: 0,
    generatedAt,
    repoRoot,
    database: {
      path: dbPath,
      exists,
      schemaVersion: null,
      requiredSchemaVersion,
      tables: emptyTableState(),
      telemetryTables: false,
      error: null
    },
    index: {
      latestRun: null,
      latestCompletedRun: null,
      coverage: null,
      adapterRuns: []
    },
    vector: {
      sqliteVecLoaded: null,
      vecTables: [],
      factEmbeddingRows: null,
      models: []
    },
    telemetry: {
      toolRuns: null,
      resourceAccesses: null,
      latestToolRunAt: null,
      latestResourceAccessAt: null
    },
    findings: []
  };
}

export function emptyTableState(): DoctorTableState {
  return {
    schemaVersions: false,
    repos: false,
    indexRuns: false,
    adapterRuns: false,
    indexCoverage: false,
    factEmbeddings: false,
    contextToolRuns: false,
    contextResourceAccesses: false,
    contextPacks: false
  };
}