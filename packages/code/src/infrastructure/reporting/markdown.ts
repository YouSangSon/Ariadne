import { PRODUCT_NAME } from "../../domain/branding.js";
import type { ImpactReport } from "../../domain/model.js";

export function renderMarkdown(report: ImpactReport): string {
  const affected = report.affectedFiles
    .map((file) => `- ${file.path} - ${file.reason} (${file.confidence}${file.depth ? `, depth ${file.depth}` : ''})`)
    .join('\n') || '- None';
  const warnings = report.warnings?.map((warning) => `- ${warning}`).join('\n') ?? '- None';
  const tests = report.actions
    .filter((action) => action.kind === 'verify')
    .map((action) => `- \`${action.display}\``)
    .join('\n') || '- None';
  const adapterInsights = report.adapterInsights
    ?.map((adapter) => {
      const gaps = adapter.knownGaps.length > 0
        ? adapter.knownGaps.map((gap) => `  - ${gap}`).join('\n')
        : '  - None declared';
      const errorSummary = adapter.errorSummary ? `\n  - Error: ${adapter.errorSummary}` : '';
      return `- ${adapter.id}@${adapter.version} - ${adapter.status}, ${adapter.confidence} (${adapter.languageIds.join(', ') || 'no files'})${errorSummary}\n${gaps}`;
    })
    .join('\n') ?? '- None';
  const evidence = report.evidence
    .map((item) => `### ${item.id}\n\nFile: \`${item.file}\`\n\nKind: ${item.kind}\n\nConfidence: ${item.confidence}\n\n\`\`\`text\n${item.snippet}\n\`\`\``)
    .join('\n\n');

  return `# ${PRODUCT_NAME} Report

Report ID: ${report.id}

Index run: ${report.indexRunId}

## Changed Files

${report.changedFiles.map((file) => `- ${file}`).join('\n')}

## Affected Files

${affected}

## Test Commands

${tests}

## Warnings

${warnings}

## Adapter Confidence

${adapterInsights}

## Evidence

${evidence}
`;
}