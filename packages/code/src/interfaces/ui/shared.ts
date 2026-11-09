import type { UiEvidencePreview } from "../../application/context/ui-model.js";
import { isCrossRepoEvidence } from "../../application/context/ui-projection.js";
import type { ImpactAction, ImpactReport } from "../../domain/model.js";

type SourceLocation = {
  href: string;
  label: string;
  line: number;
};

export type SourceLinkContext = {
  reportId?: string | null;
  language?: string | null;
};

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function shortenMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 5) return value.slice(0, maxLength);
  const prefixLength = Math.ceil((maxLength - 1) / 2);
  const suffixLength = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, prefixLength)}…${value.slice(value.length - suffixLength)}`;
}

export function sourceHref(file: string, line: number, context: SourceLinkContext = {}): string {
  const query = new URLSearchParams();
  query.set('path', file);
  query.set('line', String(line));
  if (context.reportId) query.set('report', context.reportId);
  if (context.language) query.set('lang', context.language);
  return `/source?${query.toString()}`;
}

export function entityLabel(entity: ImpactReport['changed'][number]): string {
  return entity.displayName ?? entity.path ?? entity.symbol ?? entity.id;
}

export function actionCommandText(item: ImpactAction): string | undefined {
  if (!item.command) return undefined;
  return [item.command, ...(item.args ?? [])].map(shellQuoteForUi).join(' ');
}

function shellQuoteForUi(value: string): string {
  const displayValue = value
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (displayValue === '--') return displayValue;
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(displayValue) && !displayValue.startsWith('-')) return displayValue;
  return `'${displayValue.replaceAll("'", `'\\''`)}'`;
}

export function evidenceSourceLocation(item: UiEvidencePreview, context: SourceLinkContext = {}): SourceLocation | undefined {
  if (isCrossRepoEvidence(item)) return undefined;
  if (!item.file || item.file.includes('\0')) return undefined;
  const line = item.startLine ?? 1;
  if (!Number.isInteger(line) || line < 1) return undefined;
  const endLine = item.endLine && item.endLine > line ? item.endLine : undefined;
  return {
    href: sourceHref(item.file, line, context),
    label: endLine ? `L${line}-L${endLine}` : `L${line}`,
    line
  };
}
export { actionByTargetPath,classifyImpactLane,compareAffectedFilesForUi,confidenceSortRank,errorMessage,impactEvidenceMatchesPath,isCrossRepoEvidence,isCrossRepoImpactPath,isRecord,objectAt,stringAt,topAffectedFilesForSummary } from "../../application/context/ui-projection.js";
