import type { ImpactAction } from "../../domain/model.js";
import { buildImpactLanes } from "./impact-lanes.js";
import { comparisonBucket, reportDeltaPolicyPresets, reportDeltaPolicyReason, reportDeltaSummary, reportReviewLoad } from "./report-delta.js";
import type { ReportRow, UiReportComparison, UiReportComparisonAffectedFile, UiReportDeltaPolicy, UiReportPreview } from "./ui-model.js";
import { reportPreviewFromRow, workArtifactsFromReportRow } from "./ui-projection.js";

export function reportComparisonFromRows(
  currentRow: ReportRow,
  previousRow: ReportRow,
  policy: UiReportDeltaPolicy
): UiReportComparison {
  const current = reportPreviewFromRow(currentRow);
  const previous = reportPreviewFromRow(previousRow);
  const currentAffectedPaths = new Set(current.affectedFiles.map((item) => item.path));
  const previousAffectedPaths = new Set(previous.affectedFiles.map((item) => item.path));
  const addedAffectedFiles = sortedAffectedFileDifference(current.affectedFiles, previousAffectedPaths);
  const removedAffectedFiles = sortedAffectedFileDifference(previous.affectedFiles, currentAffectedPaths);
  const currentActionTargets = actionTargetLabels(current.actions);
  const previousActionTargets = actionTargetLabels(previous.actions);
  const currentLoad = reportReviewLoad(current, policy);
  const previousLoad = reportReviewLoad(previous, policy);
  const reviewLoadDelta = currentLoad - previousLoad;
  const summary = reportDeltaSummary(reviewLoadDelta, policy);
  const currentLanes = buildImpactLanes(current, workArtifactsFromReportRow(currentRow));
  const previousLanesById = new Map(
    buildImpactLanes(previous, workArtifactsFromReportRow(previousRow)).map((lane) => [lane.id, lane])
  );

  return {
    baseReportId: previous.id,
    baseCreatedAt: previous.createdAt,
    summary,
    reviewLoadCurrent: currentLoad,
    reviewLoadPrevious: previousLoad,
    reviewLoadDelta,
    policy,
    policyReason: reportDeltaPolicyReason(summary, reviewLoadDelta, policy),
    policyPresets: reportDeltaPolicyPresets(current, previous, policy),
    changedDelta: current.changedCount - previous.changedCount,
    affectedDelta: current.affectedCount - previous.affectedCount,
    evidenceDelta: current.evidenceCount - previous.evidenceCount,
    actionDelta: current.actionCount - previous.actionCount,
    addedAffectedPaths: addedAffectedFiles.map((item) => item.path),
    removedAffectedPaths: removedAffectedFiles.map((item) => item.path),
    addedAffectedFiles,
    removedAffectedFiles,
    addedActionTargets: sortedSetDifference(currentActionTargets, previousActionTargets),
    removedActionTargets: sortedSetDifference(previousActionTargets, currentActionTargets),
    confidenceDeltas: ['proven', 'inferred', 'heuristic', 'unknown'].map((label) =>
      comparisonBucket(
        label,
        current.affectedFiles.filter((item) => item.confidence === label).length,
        previous.affectedFiles.filter((item) => item.confidence === label).length
      )
    ),
    laneDeltas: currentLanes.map((lane) => {
      const previousLane = previousLanesById.get(lane.id);
      return {
        id: lane.id,
        label: lane.label,
        tone: lane.tone,
        current: lane.count,
        previous: previousLane?.count ?? 0,
        delta: lane.count - (previousLane?.count ?? 0),
        ...(lane.topPath ? { topPath: lane.topPath } : {})
      };
    })
  };
}

export function actionTargetLabels(actions: readonly ImpactAction[]): Set<string> {
  return new Set(actions.map((action) =>
    action.target.path ?? action.target.displayName ?? action.target.symbol ?? action.target.id
  ));
}

export function sortedSetDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((item) => !right.has(item)).sort((a, b) => a.localeCompare(b));
}

export function sortedAffectedFileDifference(
  affectedFiles: readonly UiReportPreview['affectedFiles'][number][],
  excludedPaths: ReadonlySet<string>
): UiReportComparisonAffectedFile[] {
  return affectedFiles
    .filter((item) => !excludedPaths.has(item.path))
    .sort((a, b) => a.path.localeCompare(b.path));
}