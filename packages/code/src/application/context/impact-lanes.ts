import type { ImpactLane, UiMessages, UiReportPreview, UiWorkArtifactImpact } from "./ui-model.js";
import { classifyImpactLane, compareAffectedFilesForUi } from "./ui-projection.js";

export function buildImpactLanes(
  report: UiReportPreview,
  workArtifacts: readonly UiWorkArtifactImpact[],
  m?: UiMessages
): ImpactLane[] {
  const lanes: ImpactLane[] = [
    { id: 'code', label: m?.runtimeCode ?? 'Runtime code', count: 0, summary: m?.noSourceFilesAffected ?? 'No source files affected', tone: 'green' },
    { id: 'tests', label: m?.testsToVerify ?? 'Tests to verify', count: 0, summary: m?.noTestTargetDetected ?? 'No test target detected', tone: 'amber' },
    { id: 'knowledge', label: m?.docsPolicy ?? 'Docs & policy', count: 0, summary: m?.noKnowledgeArtifactAffected ?? 'No knowledge artifact affected', tone: 'teal' },
    { id: 'crossRepo', label: m?.crossRepoLane ?? 'Cross-repo consumers', count: 0, summary: m?.noCrossRepoImpact ?? 'No cross-repo consumer impact', tone: 'red' },
    { id: 'contracts', label: m?.contractsLane ?? 'Contracts', count: 0, summary: m?.noApiContractAffected ?? 'No API contract affected', tone: 'red' },
    { id: 'config', label: m?.configInfra ?? 'Config & infra', count: 0, summary: m?.noConfigSurfaceAffected ?? 'No config surface affected', tone: 'blue' }
  ];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const pathsByLane = new Map<ImpactLane['id'], UiReportPreview['affectedFiles']>();
  for (const lane of lanes) pathsByLane.set(lane.id, []);

  const actionTargets = new Set(report.actions.map((action) => action.target.path).filter((value): value is string => Boolean(value)));
  for (const item of report.affectedFiles) {
    pathsByLane.get(classifyImpactLane(item.path, item.reason, actionTargets))?.push(item);
  }

  for (const lane of lanes) {
    const items = [...(pathsByLane.get(lane.id) ?? [])].sort(compareAffectedFilesForUi);
    lane.count = items.length;
    const topPath = items[0]?.path;
    if (topPath) lane.topPath = topPath;
    if (lane.count > 0) {
      lane.summary = lane.topPath
        ? `${lane.topPath}${lane.count > 1 ? ` +${lane.count - 1} ${m?.moreAffected ?? 'more'}` : ''}`
        : `${lane.count} affected target${lane.count === 1 ? '' : 's'}`;
    }
  }

  const knowledgeLane = laneById.get('knowledge');
  if (knowledgeLane && workArtifacts.length > 0) {
    const affectedKnowledgePaths = new Set((pathsByLane.get('knowledge') ?? []).map((item) => item.path));
    const extraArtifactCount = workArtifacts.filter((item) => !affectedKnowledgePaths.has(item.path)).length;
    knowledgeLane.count += extraArtifactCount;
    if (!knowledgeLane.topPath) {
      knowledgeLane.summary = `${workArtifacts[0]?.displayName ?? workArtifacts[0]?.path}${knowledgeLane.count > 1 ? ` +${knowledgeLane.count - 1} ${m?.moreAffected ?? 'more'}` : ''}`;
    } else if (extraArtifactCount > 0) {
      knowledgeLane.summary = `${knowledgeLane.topPath} +${knowledgeLane.count - 1} ${m?.moreAffected ?? 'more'}`;
    }
  }

  return lanes;
}