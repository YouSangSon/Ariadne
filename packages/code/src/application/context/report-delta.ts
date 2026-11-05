import type { UiReportComparisonBucket, UiReportDeltaPolicy, UiReportDeltaPolicyPreset, UiReportPreview } from "./ui-model.js";
import { objectAt } from "./ui-projection.js";

export type ReportDeltaSummary = 'wider' | 'narrower' | 'unchanged';

export function formatSignedDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

export function defaultReportDeltaPolicy(): UiReportDeltaPolicy {
  return {
    source: 'default',
    widenThreshold: 1,
    narrowThreshold: 1,
    weights: {
      affected: 3,
      actions: 5,
      evidence: 1
    }
  };
}

export function policyNumberAt(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number | undefined {
  const candidate = value[key];
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return undefined;
  if (candidate < min || candidate > max) return undefined;
  return candidate;
}

export function reportDeltaPolicyPresets(
  current: UiReportPreview,
  previous: UiReportPreview,
  activePolicy: UiReportDeltaPolicy
): UiReportDeltaPolicyPreset[] {
  const presets: Array<{ id: string; label: string; policy: UiReportDeltaPolicy }> = [
    { id: 'active', label: 'Active', policy: activePolicy },
    { id: 'strict', label: 'Strict', policy: strictReportDeltaPolicy() },
    { id: 'relaxed', label: 'Relaxed', policy: relaxedReportDeltaPolicy() },
    { id: 'action-heavy', label: 'Action-heavy', policy: actionHeavyReportDeltaPolicy() }
  ];
  return presets.map((item) => {
    const currentLoad = reportReviewLoad(current, item.policy);
    const previousLoad = reportReviewLoad(previous, item.policy);
    const reviewLoadDelta = currentLoad - previousLoad;
    return {
      id: item.id,
      label: item.label,
      summary: reportDeltaSummary(reviewLoadDelta, item.policy),
      reviewLoadDelta,
      widenThreshold: item.policy.widenThreshold,
      narrowThreshold: item.policy.narrowThreshold,
      weights: item.policy.weights
    };
  });
}

export function strictReportDeltaPolicy(): UiReportDeltaPolicy {
  return {
    source: 'default',
    widenThreshold: 6,
    narrowThreshold: 6,
    weights: {
      affected: 4,
      actions: 7,
      evidence: 1
    }
  };
}

export function relaxedReportDeltaPolicy(): UiReportDeltaPolicy {
  return {
    source: 'default',
    widenThreshold: 24,
    narrowThreshold: 12,
    weights: {
      affected: 2,
      actions: 3,
      evidence: 1
    }
  };
}

export function actionHeavyReportDeltaPolicy(): UiReportDeltaPolicy {
  return {
    source: 'default',
    widenThreshold: 10,
    narrowThreshold: 8,
    weights: {
      affected: 2,
      actions: 8,
      evidence: 1
    }
  };
}

export function reportReviewLoad(report: UiReportPreview, policy: UiReportDeltaPolicy): number {
  return report.affectedCount * policy.weights.affected
    + report.actionCount * policy.weights.actions
    + report.evidenceCount * policy.weights.evidence;
}

export function reportDeltaSummary(delta: number, policy: UiReportDeltaPolicy): ReportDeltaSummary {
  if (delta >= policy.widenThreshold) return 'wider';
  if (delta <= -policy.narrowThreshold) return 'narrower';
  return 'unchanged';
}

export function reportDeltaPolicyReason(
  summary: ReportDeltaSummary,
  delta: number,
  policy: UiReportDeltaPolicy
): string {
  const formattedDelta = formatSignedDelta(delta);
  if (summary === 'wider') {
    return `Review load changed by ${formattedDelta}; ${policy.source} policy marks wider at +${policy.widenThreshold}.`;
  }
  if (summary === 'narrower') {
    return `Review load changed by ${formattedDelta}; ${policy.source} policy marks narrower at -${policy.narrowThreshold}.`;
  }
  return `Review load changed by ${formattedDelta}; ${policy.source} policy keeps it inside +${policy.widenThreshold}/-${policy.narrowThreshold}.`;
}

export function comparisonBucket(label: string, current: number, previous: number): UiReportComparisonBucket {
  return { label, current, previous, delta: current - previous };
}
export function configuredReportDeltaPolicy(parsed: unknown): UiReportDeltaPolicy {
  const fallback = defaultReportDeltaPolicy();
  const rawPolicy = objectAt(objectAt(parsed, 'ui'), 'reportDeltaPolicy');
  if (!rawPolicy) return fallback;
  const rawWeights = objectAt(rawPolicy, 'weights');
  return {
    source: 'config',
    widenThreshold: policyNumberAt(rawPolicy, 'widenThreshold', 1, 1_000) ?? fallback.widenThreshold,
    narrowThreshold: policyNumberAt(rawPolicy, 'narrowThreshold', 1, 1_000) ?? fallback.narrowThreshold,
    weights: {
      affected: rawWeights ? policyNumberAt(rawWeights, 'affected', 0, 1_000) ?? fallback.weights.affected : fallback.weights.affected,
      actions: rawWeights ? policyNumberAt(rawWeights, 'actions', 0, 1_000) ?? fallback.weights.actions : fallback.weights.actions,
      evidence: rawWeights ? policyNumberAt(rawWeights, 'evidence', 0, 1_000) ?? fallback.weights.evidence : fallback.weights.evidence
    }
  };
}