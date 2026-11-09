import { PACKAGE_NAME } from "../../domain/branding.js";
import { reportComparisonFromRows } from "./report-comparison.js";
import type { ReportRow, UiError, UiOptions, UiReportDeltaPolicy, UiSnapshot } from "./ui-model.js";
import type { UiSnapshotPorts } from "./ui-ports.js";
import { reportPreviewFromRow, reportSummaryFromRow, workArtifactsFromReportRow } from "./ui-projection.js";

export async function buildUiSnapshot(options: UiOptions, ports: UiSnapshotPorts): Promise<UiSnapshot> {
  const repoRoot = ports.normalizeRoot(options.repoRoot);
  const doctor = ports.doctor({ repoRoot });
  const generatedAt = new Date().toISOString();
  if (!doctor.database.exists || !ports.hasDatabase(repoRoot)) {
    return {
      version: 0,
      generatedAt,
      repoRoot,
      selectedReportId: null,
      doctor,
      errors: [{
        code: 'database_missing',
        message: 'Impact database not found for this repository.',
        fix: `Run ${PACKAGE_NAME} init and ${PACKAGE_NAME} index before opening the UI.`
      }],
      reports: [],
      selectedReport: null,
      graph: null,
      coverage: null,
      contextPacks: [],
      workArtifacts: [],
      workspaces: [],
      comparison: null
    };
  }

  const session = ports.openSession(repoRoot);
  try {
    const reportRows = session.reports();
    const requestedReport = options.reportId
      ? reportRows.find((row) => row.id === options.reportId) ?? session.report(options.reportId)
      : undefined;
    const selectorRows =
      requestedReport && !reportRows.some((row) => row.id === requestedReport.id)
        ? [requestedReport, ...reportRows.slice(0, 19)]
        : reportRows;
    const reports = selectorRows.map(reportSummaryFromRow);
    const errors: UiError[] = [];
    if (options.reportId && !requestedReport) {
      errors.push({
        code: 'report_not_found',
        message: `Impact report not found: ${options.reportId}`,
        fix: `Choose a report from the selector or run ${PACKAGE_NAME} analyze to create a current report.`
      });
    } else if (!options.reportId && reportRows.length === 0) {
      errors.push({
        code: 'report_missing',
        message: 'No persisted impact reports were found.',
        fix: `Run ${PACKAGE_NAME} analyze --changed <path> to create a report.`
      });
    }
    const selectedRow = requestedReport ?? (options.reportId ? null : reportRows[0] ?? null);
    const selectedReport = selectedRow ? reportPreviewFromRow(selectedRow) : null;
    const graph = selectedRow ? await ports.graphPreview(repoRoot, selectedRow.id) : null;
    const reportDeltaPolicy = ports.deltaPolicy(repoRoot);
    const comparison = selectedRow ? compareWithPrevious(session.previousReport(selectedRow), selectedRow, reportDeltaPolicy) : null;
    return {
      version: 0,
      generatedAt,
      repoRoot,
      selectedReportId: selectedRow?.id ?? null,
      doctor,
      errors,
      reports,
      selectedReport,
      graph,
      coverage: session.coverage(),
      contextPacks: session.contextPacks(),
      workArtifacts: selectedRow ? workArtifactsFromReportRow(selectedRow) : [],
      workspaces: session.workspaces(),
      comparison
    };
  } finally {
    session.close();
  }
}
function compareWithPrevious(previous: ReportRow | null, selected: ReportRow, policy: UiReportDeltaPolicy) {
  return previous ? reportComparisonFromRows(selected, previous, policy) : null;
}