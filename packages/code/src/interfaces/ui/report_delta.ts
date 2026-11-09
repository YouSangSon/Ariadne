import { formatSignedDelta } from "../../application/context/report-delta.js";
import type { UiMessages, UiReportComparison, UiReportComparisonAffectedFile, UiReportDeltaPolicy, UiReportDeltaPolicyPreset } from "../../application/context/ui-model.js";
import { escapeHtml } from "./shared.js";
import type { SourceLinkContext } from "./shared.js";

export function renderReportDeltaPanel(
  comparison: UiReportComparison | null,
  m: UiMessages,
  sourceContext: SourceLinkContext = {}
): string {
  if (!comparison) return '';
  const headline = comparison.summary === 'wider'
    ? m.impactWidened
    : comparison.summary === 'narrower'
      ? m.impactNarrowed
      : m.impactUnchanged;
  const headlineDetail = comparison.policyReason;
  const metricRows = [
    { label: m.reviewLoad, value: String(comparison.reviewLoadCurrent), meta: formatSignedDelta(comparison.reviewLoadDelta), delta: comparison.reviewLoadDelta },
    { label: m.affectedPaths, value: formatSignedDelta(comparison.affectedDelta), meta: m.delta, delta: comparison.affectedDelta },
    { label: m.evidence, value: formatSignedDelta(comparison.evidenceDelta), meta: m.delta, delta: comparison.evidenceDelta },
    { label: m.actions, value: formatSignedDelta(comparison.actionDelta), meta: m.delta, delta: comparison.actionDelta }
  ].map((item) => `
    <li class="${escapeHtml(deltaClass(item.delta))}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <em>${escapeHtml(item.meta)}</em>
    </li>
  `).join('');
  const laneRows = comparison.laneDeltas.map((lane) => {
    const detail = lane.delta === 0 ? `${lane.current} current` : lane.topPath ?? `${lane.current} current`;
    return `
      <li class="delta-lane delta-lane-${escapeHtml(lane.tone)} ${escapeHtml(deltaClass(lane.delta))}">
        <span>${escapeHtml(lane.label)}</span>
        <b>${escapeHtml(formatSignedDelta(lane.delta))}</b>
        <small>${escapeHtml(detail)}</small>
      </li>
    `;
  }).join('');
  const confidenceRows = comparison.confidenceDeltas
    .filter((item) => item.current > 0 || item.previous > 0 || item.delta !== 0)
    .map((item) => `
      <span class="${escapeHtml(deltaClass(item.delta))}">
        <b>${escapeHtml(formatSignedDelta(item.delta))}</b>${escapeHtml(item.label)}
      </span>
    `).join('');
  const addedRows = renderDeltaPathRows(comparison.addedAffectedFiles ?? comparison.addedAffectedPaths, 'added', m, sourceContext);
  const removedRows = renderDeltaPathRows(comparison.removedAffectedFiles ?? comparison.removedAffectedPaths, 'removed', m, sourceContext);
  const presetRows = comparison.policyPresets.map((preset) => `
    <li class="delta-preset delta-preset-${escapeHtml(preset.summary)}">
      <button class="delta-preset-select" type="button" data-policy-preset="${escapeHtml(preset.id)}">
        <strong>${escapeHtml(preset.label)}</strong>
        <span>${escapeHtml(preset.summary)}</span>
        <b>${escapeHtml(formatSignedDelta(preset.reviewLoadDelta))}</b>
        <small>+${escapeHtml(String(preset.widenThreshold))}/-${escapeHtml(String(preset.narrowThreshold))} · ${escapeHtml(policyWeightsLabel(preset.weights))}</small>
      </button>
      <button class="copy-command" type="button" ${copyCommandAttribute(reportDeltaPolicyConfigPatch(preset))} aria-label="${escapeHtml(`${m.ariaCopyConfigPrefix} ${preset.label}`)}">${escapeHtml(m.copyConfig)}</button>
    </li>
  `).join('');

  return `
    <section class="panel report-delta-panel" aria-label="${escapeHtml(m.ariaSavedReportComparison)}">
      <div class="panel-heading">
        <h2>${escapeHtml(m.reportDelta)}</h2>
        <div class="panel-chips">
          <span>vs ${escapeHtml(comparison.baseReportId)}</span>
          <span>policy ${escapeHtml(comparison.policy.source)}</span>
          <span>widen +${escapeHtml(String(comparison.policy.widenThreshold))}</span>
          <span>narrow -${escapeHtml(String(comparison.policy.narrowThreshold))}</span>
          <span>${escapeHtml(comparison.baseCreatedAt)}</span>
        </div>
      </div>
      <div class="delta-content">
        <div class="delta-hero delta-hero-${escapeHtml(comparison.summary)}">
          <span>${escapeHtml(m.savedReportComparison)}</span>
          <strong>${escapeHtml(headline)}</strong>
          <small>${escapeHtml(headlineDetail)}</small>
        </div>
        <ul class="delta-metrics" aria-label="${escapeHtml(m.ariaDeltaMetricsList)}">${metricRows}</ul>
        <div class="delta-detail">
          <div class="delta-confidence" aria-label="${escapeHtml(m.ariaConfidenceDelta)}">${confidenceRows || `<span><b>0</b>${escapeHtml(m.stableConfidence)}</span>`}</div>
          <ul class="delta-lanes">${laneRows}</ul>
          <div class="delta-policy" aria-label="${escapeHtml(m.ariaPolicyWeights)}">
            <span>${escapeHtml(m.affectedWeight)} ${escapeHtml(String(comparison.policy.weights.affected))}</span>
            <span>${escapeHtml(m.actionWeight)} ${escapeHtml(String(comparison.policy.weights.actions))}</span>
            <span>${escapeHtml(m.evidenceWeight)} ${escapeHtml(String(comparison.policy.weights.evidence))}</span>
          </div>
          <ul class="delta-presets" aria-label="${escapeHtml(m.ariaPresetComparison)}">${presetRows}</ul>
          <div class="delta-paths">
            <section>
              <h3>${escapeHtml(m.addedImpact)}</h3>
              <ul>${addedRows || `<li>${escapeHtml(m.none)}</li>`}</ul>
            </section>
            <section>
              <h3>${escapeHtml(m.removedImpact)}</h3>
              <ul>${removedRows || `<li>${escapeHtml(m.none)}</li>`}</ul>
            </section>
          </div>
        </div>
      </div>
    </section>
  `;
}

function deltaClass(delta: number): string {
  if (delta > 0) return 'delta-positive';
  if (delta < 0) return 'delta-negative';
  return 'delta-neutral';
}

function policyWeightsLabel(weights: UiReportDeltaPolicy['weights']): string {
  return `aff${weights.affected}/act${weights.actions}/ev${weights.evidence}`;
}

function reportDeltaPolicyConfigPatch(policy: Pick<UiReportDeltaPolicyPreset, 'widenThreshold' | 'narrowThreshold' | 'weights'>): string {
  return JSON.stringify(
    {
      ui: {
        reportDeltaPolicy: {
          widenThreshold: policy.widenThreshold,
          narrowThreshold: policy.narrowThreshold,
          weights: policy.weights
        }
      }
    },
    null,
    2
  );
}

function copyCommandAttribute(value: string): string {
  return `data-command="${escapeHtml(value).replaceAll('\n', '&#10;')}"`;
}

function renderDeltaPathRows(
  paths: readonly (string | UiReportComparisonAffectedFile)[],
  mode: 'added' | 'removed',
  m: UiMessages,
  sourceContext: SourceLinkContext
): string {
  return paths.slice(0, 4).map((item) => {
    const pathValue = typeof item === 'string' ? item : item.path;
    if (mode === 'added') {
      return `
        <li class="delta-path-row" data-filter-text="${escapeHtml(`added impact ${pathValue}`)}">
          <button class="delta-path-select selectable-impact" type="button" data-impact-path="${escapeHtml(pathValue)}" data-filter-text="${escapeHtml(`added impact ${pathValue}`)}">
            <span>${escapeHtml(pathValue)}</span>
            <small>${escapeHtml(m.inspectImpact)}</small>
          </button>
          </li>
      `;
    }
    return `
      <li class="delta-path-row" data-filter-text="${escapeHtml(`removed impact ${pathValue}`)}">
        <span>${escapeHtml(pathValue)}</span>
        <small>${escapeHtml(m.noLongerAffected)}</small>
      </li>
    `;
  }).join('');
}

export { comparisonBucket,defaultReportDeltaPolicy,formatSignedDelta,policyNumberAt,reportDeltaPolicyPresets,reportDeltaPolicyReason,reportDeltaSummary,reportReviewLoad } from "../../application/context/report-delta.js";
