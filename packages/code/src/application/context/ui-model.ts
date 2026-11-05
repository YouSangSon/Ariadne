import type { DoctorReport } from "../../domain/indexing/diagnostics.js";
import type { GraphExport, ImpactAction, ImpactReport } from "../../domain/model.js";
import type { MarkdownArtifactMetadata } from "../../domain/workspace/artifacts.js";

export type UiOptions = {
  repoRoot: string;
  reportId?: string;
};

export type UiServerOptions = UiOptions & {
  host?: string;
  port?: number;
};

export type ImpactLaneId = 'code' | 'tests' | 'knowledge' | 'contracts' | 'config' | 'crossRepo';

export type ImpactLaneTone = 'green' | 'amber' | 'teal' | 'blue' | 'red';

export type ReportDeltaSummary = 'wider' | 'narrower' | 'unchanged';

export type UiSnapshot = {
  version: 0;
  generatedAt: string;
  repoRoot: string;
  selectedReportId: string | null;
  doctor: DoctorReport;
  errors: UiError[];
  reports: UiReportSummary[];
  selectedReport: UiReportPreview | null;
  graph: UiGraphPreview | null;
  coverage: UiCoverageSnapshot | null;
  contextPacks: UiContextPackSummary[];
  workArtifacts: UiWorkArtifactImpact[];
  workspaces: UiWorkspaceSnapshot[];
  comparison: UiReportComparison | null;
};

export type UiError = {
  code: string;
  message: string;
  fix?: string;
};

export type UiReportSummary = {
  id: string;
  indexRunId: number;
  createdAt: string;
  changedFiles: string[];
  changedCount: number;
  affectedCount: number;
  evidenceCount: number;
  actionCount: number;
};

export type UiReportPreview = UiReportSummary & {
  changed: ImpactReport['changed'];
  affectedFiles: ImpactReport['affectedFiles'];
  evidence: UiEvidencePreview[];
  crossRepoImpacts: NonNullable<ImpactReport['crossRepoImpacts']>;
  adapterInsights: NonNullable<ImpactReport['adapterInsights']>;
  actions: ImpactAction[];
  warnings: string[];
};

export type UiReportComparison = {
  baseReportId: string;
  baseCreatedAt: string;
  summary: ReportDeltaSummary;
  reviewLoadCurrent: number;
  reviewLoadPrevious: number;
  reviewLoadDelta: number;
  policy: UiReportDeltaPolicy;
  policyReason: string;
  policyPresets: UiReportDeltaPolicyPreset[];
  changedDelta: number;
  affectedDelta: number;
  evidenceDelta: number;
  actionDelta: number;
  addedAffectedPaths: string[];
  removedAffectedPaths: string[];
  addedAffectedFiles: UiReportComparisonAffectedFile[];
  removedAffectedFiles: UiReportComparisonAffectedFile[];
  addedActionTargets: string[];
  removedActionTargets: string[];
  confidenceDeltas: UiReportComparisonBucket[];
  laneDeltas: UiReportComparisonLane[];
};

export type UiReportComparisonAffectedFile = UiReportPreview['affectedFiles'][number];

export type UiReportComparisonBucket = {
  label: string;
  current: number;
  previous: number;
  delta: number;
};

export type UiReportComparisonLane = {
  id: ImpactLaneId;
  label: string;
  tone: ImpactLaneTone;
  current: number;
  previous: number;
  delta: number;
  topPath?: string;
};

export type UiReportDeltaPolicy = {
  source: 'default' | 'config';
  widenThreshold: number;
  narrowThreshold: number;
  weights: {
    affected: number;
    actions: number;
    evidence: number;
  };
};

export type UiReportDeltaPolicyPreset = {
  id: string;
  label: string;
  summary: ReportDeltaSummary;
  reviewLoadDelta: number;
  widenThreshold: number;
  narrowThreshold: number;
  weights: UiReportDeltaPolicy['weights'];
};

export type UiEvidencePreview = ImpactReport['evidence'][number] & {
  snippetOmitted?: boolean;
  omittedReason?: string;
  resourceUri?: string;
};

export type UiGraphPreview = {
  nodes: GraphExport['nodes'];
  edges: GraphExport['edges'];
  totalNodes: number;
  totalEdges: number;
};

export type UiContextPackSummary = {
  id: string;
  budget: string;
  indexRunId: number;
  returnedBytes: number;
  hitCount: number;
  createdAt: string;
  lastAccessedAt: string;
};

export type UiCoverageSnapshot = {
  indexRunId: number;
  coverage: Array<{
    path: string;
    languageId: string | null;
    status: string;
    reason: string;
    adapterId: string;
  }>;
  limit: number;
  truncated: boolean;
};

export type UiWorkArtifactImpact = {
  kind: string;
  path: string;
  displayName: string;
  reason: string;
  confidence: string;
  relations: string[];
  resourceUri: string;
  depth?: number;
  metadata?: MarkdownArtifactMetadata;
  freshness: UiWorkArtifactFreshness;
};

export type UiWorkArtifactFreshness = {
  state: 'current' | 'stale' | 'unknown';
  label: string;
  thresholdDays: number;
  ageDays?: number;
};

export type UiWorkspaceSnapshot = {
  name: string;
  repoCount: number;
  contracts: UiWorkspaceContract[];
  links: UiWorkspaceLink[];
  warnings: string[];
  resources: {
    workspace: string;
    contracts: string;
    crossRepoLinks: string;
  };
  limits: {
    contracts: number;
    links: number;
    contractsTruncated: boolean;
    linksTruncated: boolean;
  };
};

export type UiWorkspaceContract = {
  id: string;
  serviceName: string;
  repoPath: string;
  path: string;
  kind: string;
  indexRunId: number;
  endpointCount: number;
  schemaVersion?: string;
};

export type UiWorkspaceLink = {
  id: string;
  kind: string;
  confidence: string;
  sourceService: string;
  targetService: string;
  routeLabel?: string;
  consumerPath?: string;
  providerContractPath?: string;
  eventTopology?: {
    providerAction: string;
    counterpartyRole: 'consumer' | 'producer' | 'unknown';
    pattern: string;
  };
};

export type ReportRow = {
  id: string;
  index_run_id: number;
  json: string;
  created_at: string;
};

export type SourceLocation = {
  href: string;
  label: string;
  line: number;
};

export type ImpactMapNode = {
  id: string;
  label: string;
  kind: string;
  group: 'changed' | 'affected' | 'context';
  confidence?: string;
  laneLabel?: string;
  laneTone?: ImpactLaneTone;
  path?: string;
};

export type ImpactMapEdge = {
  from: string;
  to: string;
  label: string;
  confidence: string;
  targetPath?: string;
};

export type ImpactLane = {
  id: ImpactLaneId;
  label: string;
  count: number;
  summary: string;
  tone: ImpactLaneTone;
  topPath?: string;
};

export type UiLanguage = 'en' | 'ko' | 'zh';

export type UiMessageKey =
  | 'eyebrow' | 'workbench' | 'controls' | 'reportSelector' | 'noReports' | 'selectReport'
  | 'filterPlaceholder' | 'filterRows' | 'metrics' | 'indexStatus' | 'changed' | 'affected'
  | 'evidence' | 'actions' | 'coverageGapsMetric' | 'workArtifactsMetric' | 'workspacesMetric'
  | 'changeSet' | 'verificationQueue' | 'impactPaths' | 'evidencePanel' | 'workArtifacts'
  | 'doctorFindings' | 'contextPacks' | 'adapterConfidence' | 'workspaceContracts'
  | 'workspaceResources' | 'coverageGaps' | 'resourceContract' | 'language'
  // Sub-headings and section titles
  | 'impactSummary' | 'topImpact' | 'analysisTrust' | 'coverage' | 'adapters' | 'knownGaps'
  | 'impactTriage' | 'reportDelta' | 'addedImpact' | 'removedImpact' | 'policyPresets'
  | 'impactMap' | 'topRoutes' | 'primaryImpactFlow' | 'impactInspector' | 'confidence'
  | 'relationPath' | 'evidenceHits' | 'topEvidence'
  // Inline labels
  | 'blastRadius' | 'changedRoot' | 'affectedTargets' | 'nextVerification' | 'affectedTargetEmpty'
  | 'contextNode' | 'source' | 'target' | 'affectedTargetRole' | 'changedInput'
  | 'targets' | 'totalAffected' | 'totalTargets' | 'mappedPaths' | 'confidenceInline'
  | 'runtimeCode' | 'testsToVerify' | 'docsPolicy' | 'contractsLane' | 'crossRepoLane' | 'configInfra'
  | 'noSourceFilesAffected' | 'noTestTargetDetected' | 'noKnowledgeArtifactAffected'
  | 'noApiContractAffected' | 'noCrossRepoImpact' | 'noConfigSurfaceAffected' | 'moreAffected'
  | 'impactVerdict' | 'readyToVerify' | 'evidenceReady' | 'reviewBeforeChange'
  | 'needsEvidence' | 'commandReady' | 'noCommandShort'
  | 'backToWorkbench' | 'lineLabel'
  // Buttons / actions
  | 'copy' | 'copyConfig' | 'copyVerify' | 'copyCopied' | 'copyFailed' | 'copyLink'
  | 'exportJson' | 'exportCsv' | 'exportPng' | 'exportDone' | 'exportFailed' | 'shareExport' | 'verify' | 'review'
  // Trust state labels
  | 'reviewGaps' | 'useWithGaps' | 'readyToUse'
  | 'noSkippedPaths' | 'confidenceMetadataPresent' | 'openLimitations' | 'noneReported'
  // Impact triage empty / labels
  | 'noSelectedReport' | 'none' | 'noTargets' | 'noDisplayedPaths' | 'noVerificationActionShort'
  | 'noVerificationTarget' | 'noAffectedTargetInline'
  // Report delta headlines
  | 'impactWidened' | 'impactNarrowed' | 'impactUnchanged'
  | 'reviewLoad' | 'affectedPaths' | 'delta' | 'savedReportComparison'
  | 'stableConfidence' | 'affectedWeight' | 'actionWeight' | 'evidenceWeight'
  | 'inspectImpact' | 'noLongerAffected' | 'vsPrevious'
  // Empty states
  | 'emptyRunAnalyzeBlast' | 'emptyNoAffectedTargets' | 'emptyNoChangedEntities'
  | 'emptyNoGraphNodes' | 'emptyNoVisiblePaths' | 'emptyRunAnalyzeReport'
  | 'emptyNoActionsQueued' | 'emptyNoImpactPaths' | 'emptyNoEvidence'
  | 'emptyNoWorkArtifacts' | 'emptyNoDoctorFindings' | 'emptyNoContextPacks'
  | 'emptyNoAdapterConfidence' | 'emptyNoWorkspaceContracts' | 'emptyNoWorkspaceResources'
  | 'emptyNoCoverageRows'
  // Inspector empty / placeholders
  | 'noAffectedTargetSelected' | 'selectAffectedTarget' | 'noVerificationActionRecorded'
  | 'noCommandRecorded' | 'noSourceSpanRecorded' | 'noMatchingEvidence'
  | 'directOrNotRecorded'
  // Map roles / labels
  | 'impactPathLabel' | 'changedRootLabel'
  // aria-labels
  | 'ariaImpactSummary' | 'ariaAffectedByConfidence' | 'ariaAffectedByLane' | 'ariaTrustSignals'
  | 'ariaKnownGapPreview' | 'ariaImpactTriage' | 'ariaSavedReportComparison'
  | 'ariaConfidenceDelta' | 'ariaPolicyWeights' | 'ariaPresetComparison' | 'ariaDeltaMetricsList'
  | 'ariaImpactMap' | 'ariaImpactMapLegend' | 'ariaImpactMapSymbols' | 'ariaVisibleRoutes'
  | 'ariaRankedRoutes' | 'ariaPrimaryImpactFlow' | 'ariaNextVerificationCommand'
  | 'ariaCopyMapCommand' | 'ariaImpactInspector' | 'ariaCopyInspectorCommand'
  | 'ariaImpactVerdict'
  | 'ariaRelationTrail' | 'ariaMapSvg' | 'ariaInspectImpactPath' | 'ariaOpenSourceLabel'
  | 'ariaCopyConfigPrefix' | 'ariaCopyCommandSuffix' | 'ariaCopyVerifyForPrefix'
  | 'ariaImpactOverview' | 'ariaImpactWorkbench';

export type UiMessages = Record<UiMessageKey, string>;
