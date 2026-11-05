import { workArtifactEvidenceResourceUri, workArtifactPathSet, workArtifactsFromImpactReport } from "../../domain/context/work-artifacts.js";
import type { ImpactAction, ImpactReport } from "../../domain/model.js";
import type { MarkdownArtifactMetadata } from "../../domain/workspace/artifacts.js";
import type { ImpactLane, ReportRow, UiEvidencePreview, UiReportPreview, UiReportSummary, UiWorkArtifactImpact, UiWorkspaceLink } from "./ui-model.js";

export function confidenceSortRank(confidence: string): number {
  if (confidence === 'proven') return 0;
  if (confidence === 'inferred') return 1;
  if (confidence === 'heuristic') return 2;
  return 3;
}

export function compareAffectedFilesForUi(left: UiReportPreview['affectedFiles'][number], right: UiReportPreview['affectedFiles'][number]): number {
  return confidenceSortRank(left.confidence) - confidenceSortRank(right.confidence)
    || (left.depth ?? 99) - (right.depth ?? 99)
    || left.path.localeCompare(right.path);
}

export function topAffectedFilesForSummary(report: UiReportPreview): UiReportPreview['affectedFiles'] {
  const actionTargets = new Set(report.actions.map((action) => action.target.path).filter((pathValue): pathValue is string => Boolean(pathValue)));
  return [...report.affectedFiles].sort((left, right) => {
    const leftActionable = actionTargets.has(left.path) ? 0 : 1;
    const rightActionable = actionTargets.has(right.path) ? 0 : 1;
    return leftActionable - rightActionable || compareAffectedFilesForUi(left, right);
  });
}

export function classifyImpactLane(pathValue: string, reason: string, actionTargets: ReadonlySet<string>): ImpactLane['id'] {
  const pathLower = pathValue.toLowerCase();
  const reasonLower = reason.toLowerCase();
  if (/\bcross-repo\b/i.test(reasonLower) || reasonLower.includes('breaks_compatibility_with')) return 'crossRepo';
  if (actionTargets.has(pathValue) || isUiTestPath(pathLower)) return 'tests';
  if (isUiKnowledgePath(pathLower) || /\b(governs|documents|requires|proposes)\b/.test(reasonLower)) return 'knowledge';
  if (isUiContractPath(pathLower) || /\bcontract|endpoint|asyncapi|openapi|graphql|protobuf\b/.test(reasonLower)) return 'contracts';
  if (isUiConfigPath(pathLower) || /\bconfigures|workflow|infra\b/.test(reasonLower)) return 'config';
  return 'code';
}

export function isUiTestPath(pathLower: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|(^|\/)src\/test\//.test(pathLower)
    || /(\.|-)(test|spec)\.[cm]?[tj]sx?$/.test(pathLower);
}

export function isUiKnowledgePath(pathLower: string): boolean {
  return pathLower.endsWith('.md')
    || /(^|\/)(docs|doc|policies|policy|proposals|prd|requirements|decisions|adr)\//.test(pathLower);
}

export function isUiContractPath(pathLower: string): boolean {
  return /(^|\/)(contracts?|apis?)\//.test(pathLower)
    || /(^|[-_.])(openapi|asyncapi)([-_.]|$)/.test(pathLower)
    || /\.(proto|graphql|gql|avsc)$/.test(pathLower);
}

export function isUiConfigPath(pathLower: string): boolean {
  return /(^|\/)(\.github\/workflows|terraform|infra|deploy|k8s|helm)\//.test(pathLower)
    || /(^|\/)(dockerfile|makefile|compose\.ya?ml)$/.test(pathLower)
    || /\.(ya?ml|toml|json|jsonc|env|tf|tfvars|hcl|ini)$/.test(pathLower)
    || /(^|\/)(package\.json|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|cargo\.toml|pyproject\.toml)$/.test(pathLower);
}

export function actionByTargetPath(actions: readonly ImpactAction[]): Map<string, ImpactAction> {
  const byPath = new Map<string, ImpactAction>();
  for (const action of actions) {
    const targetPath = action.target.path;
    if (!targetPath || byPath.has(targetPath)) continue;
    byPath.set(targetPath, action);
  }
  return byPath;
}

export function impactEvidenceMatchesPath(item: UiEvidencePreview, pathValue: string): boolean {
  return item.file === pathValue || item.subject?.path === pathValue || item.snippet.includes(pathValue);
}

export function isCrossRepoEvidence(item: UiEvidencePreview): boolean {
  return item.extractorId === 'cross-repo-contract-impact';
}

export function isCrossRepoImpactPath(item: UiReportPreview['affectedFiles'][number]): boolean {
  return /\bcross-repo\b/i.test(item.reason)
    || item.relationPath?.some((part) => part.includes('BREAKS_COMPATIBILITY_WITH')) === true;
}

export function objectAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

export function stringAt(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return typeof child === 'string' && child.length > 0 ? child : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

export function reportSummaryFromRow(row: ReportRow): UiReportSummary {
  const report = JSON.parse(row.json) as ImpactReport;
  return {
    id: row.id,
    indexRunId: row.index_run_id,
    createdAt: row.created_at,
    changedFiles: report.changedFiles,
    changedCount: report.changed.length,
    affectedCount: report.affectedFiles.length,
    evidenceCount: report.evidence.length,
    actionCount: report.actions.length
  };
}

export function reportPreviewFromRow(row: ReportRow): UiReportPreview {
  const report = JSON.parse(row.json) as ImpactReport;
  return {
    ...reportSummaryFromRow(row),
    changed: report.changed,
    affectedFiles: report.affectedFiles,
    evidence: evidencePreviewFromReport(report),
    crossRepoImpacts: report.crossRepoImpacts ?? [],
    adapterInsights: report.adapterInsights ?? [],
    actions: report.actions,
    warnings: report.warnings ?? []
  };
}

export const omittedWorkArtifactEvidenceSnippet = 'Work artifact evidence omitted from UI bootstrap. Open the entity resource for document details.';

export function evidencePreviewFromReport(report: ImpactReport): UiEvidencePreview[] {
  const workArtifactPaths = workArtifactPathSet(report);
  return report.evidence.map((item) => {
    const resourceUri = workArtifactEvidenceResourceUri(item, workArtifactPaths);
    if (!resourceUri) return item;
    return {
      ...item,
      snippet: omittedWorkArtifactEvidenceSnippet,
      snippetOmitted: true,
      omittedReason: 'work-artifact-resource-on-demand',
      resourceUri
    };
  });
}

export function workArtifactsFromReportRow(row: ReportRow): UiWorkArtifactImpact[] {
  const report = JSON.parse(row.json) as ImpactReport;
  return workArtifactsFromImpactReport(report, { asOfIso: row.created_at, includeDepth: true });
}

export function workArtifactMetadataText(metadata: MarkdownArtifactMetadata | undefined): string {
  if (!metadata) return '';
  return [
    metadata.owner ? `owner ${metadata.owner}` : undefined,
    metadata.status ? `status ${metadata.status}` : undefined,
    metadata.updatedAt ? `updated ${metadata.updatedAt}` : undefined
  ].filter((item): item is string => Boolean(item)).join(' · ');
}

export function entityResourceUri(entity: ImpactReport['changed'][number]): string {
  return `parallax://entities/${encodeURIComponent(entity.id)}`;
}

export function parsedProvenance(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function routeLabelFromProvenance(provenance: unknown): string | undefined {
  const http = objectAt(provenance, 'http');
  const method = stringAt(http, 'method');
  const routePath = stringAt(http, 'path');
  if (method && routePath) return `${method} ${routePath}`;

  const change = objectAt(provenance, 'change');
  const changeMethod = stringAt(change, 'method');
  const changePath = stringAt(change, 'path');
  if (changeMethod && changePath) return `${changeMethod} ${changePath}`;
  return routePath ?? changePath;
}

export function eventTopologyFromProvenance(provenance: unknown): UiWorkspaceLink['eventTopology'] | undefined {
  const topology = objectAt(provenance, 'eventTopology');
  const providerAction = stringAt(topology, 'providerAction');
  const counterpartyRole = stringAt(topology, 'counterpartyRole');
  const pattern = stringAt(topology, 'pattern');
  if (!providerAction || !pattern) return undefined;
  if (counterpartyRole !== 'consumer' && counterpartyRole !== 'producer' && counterpartyRole !== 'unknown') {
    return undefined;
  }
  return { providerAction, counterpartyRole, pattern };
}