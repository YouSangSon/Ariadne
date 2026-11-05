import { DATA_DIR, PACKAGE_NAME, PRODUCT_NAME } from "../../domain/branding.js";
import { baseReport } from "../../domain/indexing/diagnostics-state.js";
import { addCoverageFindings, addIndexFindings, addSchemaFindings } from "../../domain/indexing/diagnostics.js";
import type { DoctorOptions, DoctorReport } from "../../domain/indexing/diagnostics.js";
import type { DoctorPorts, DoctorSession } from "./doctor-ports.js";

export function doctorProject(options: DoctorOptions, ports: DoctorPorts): DoctorReport {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const dbPath = ports.databasePath(repoRoot);
  const report = baseReport(repoRoot, dbPath, ports.exists(dbPath), ports.requiredSchemaVersion, new Date().toISOString());

  if (!report.database.exists) {
    report.findings.push({
      severity: 'error',
      code: 'database_missing',
      message: `${PRODUCT_NAME} database is missing.`,
      fix: `Run ${PACKAGE_NAME} init and ${PACKAGE_NAME} index from the repository root.`
    });
    return report;
  }

  let session: DoctorSession;
  try {
    session = ports.openSession(repoRoot);
  } catch (error) {
    report.database.error = error instanceof Error ? error.message : String(error);
    report.findings.push({
      severity: 'error',
      code: 'database_unreadable',
      message: `${PRODUCT_NAME} database exists but could not be opened read-only.`,
      fix: `Check that ${DATA_DIR}/impact.db is inside this repo and rerun ${PACKAGE_NAME} init.`
    });
    return report;
  }

  try {
    report.database.tables = session.tables();
    report.database.telemetryTables =
      report.database.tables.contextToolRuns && report.database.tables.contextResourceAccesses;
    report.database.schemaVersion = session.schemaVersion(report.database.tables);
    report.vector.sqliteVecLoaded = session.vectorLoaded();
    report.vector.vecTables = session.vecTables();

    if (report.database.tables.factEmbeddings) {
      report.vector.factEmbeddingRows = session.factEmbeddingRows();
      report.vector.models = session.embeddingModels();
    }

    addSchemaFindings(report);

    if (!report.database.tables.repos || !report.database.tables.indexRuns) {
      report.findings.push({
        severity: 'error',
        code: 'index_tables_missing',
        message: 'Required index tables are missing from the database.',
        fix: `Back up ${DATA_DIR}, then rerun ${PACKAGE_NAME} init.`
      });
      return report;
    }

    const repoId = session.repoId();
    if (repoId === null) {
      report.findings.push({
        severity: 'warn',
        code: 'repo_missing',
        message: 'The database has no row for this repository root.',
        fix: `Run ${PACKAGE_NAME} init from this repository root.`
      });
      return report;
    }

    const indexRunColumns = session.indexRunColumns();
    report.index.latestRun = session.latestIndexRun(repoId, false, indexRunColumns);
    report.index.latestCompletedRun = session.latestIndexRun(repoId, true, indexRunColumns);
    addIndexFindings(report);

    if (report.index.latestCompletedRun && report.database.tables.indexCoverage) {
      report.index.coverage = session.coverage(report.index.latestCompletedRun.id);
      addCoverageFindings(report);
    }
    if (report.index.latestCompletedRun && report.database.tables.adapterRuns) {
      report.index.adapterRuns = session.adapterRuns(report.index.latestCompletedRun.id);
    }
    if (report.database.telemetryTables) {
      if (session.canReadTelemetry()) {
        report.telemetry = session.telemetry();
      } else {
        report.findings.push({
          severity: 'warn',
          code: 'telemetry_schema_incomplete',
          message: 'Context telemetry tables exist but do not have the expected columns.',
          fix: `Run ${PACKAGE_NAME} init with the current build.`
        });
      }
    }
  } catch (error) {
    report.database.error = error instanceof Error ? error.message : String(error);
    report.findings.push({
      severity: 'error',
      code: 'database_probe_failed',
      message: `${PRODUCT_NAME} database opened read-only but health probing failed.`,
      fix: `Back up ${DATA_DIR}, then run ${PACKAGE_NAME} init with the current build or recreate the index.`
    });
  } finally {
    session.close();
  }

  return report;
}