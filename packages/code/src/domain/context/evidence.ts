import { asConfidence } from "../impact/confidence.js";
import type { Confidence } from "../model.js";
import { redactSecrets } from "../security/redaction.js";
import { evidenceResourceUri, truncateSnippet } from "./context-pack.js";

export type ExplainEvidenceRow = {
  evidence_id: string;
  relation_id: string;
  evidence_file_path: string;
  evidence_kind: string;
  evidence_snippet: string;
  evidence_confidence: string;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  evidence_start_col: number | null;
  evidence_end_col: number | null;
};

export type CompactEvidenceResource = {
  id: string;
  file: string;
  kind: string;
  snippet: string;
  confidence: Confidence;
  resourceUri: string;
  startLine?: number;
  endLine?: number;
  startCol?: number;
  endCol?: number;
};

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function compactEvidenceResource(row: ExplainEvidenceRow, snippetChars = 300): CompactEvidenceResource {
  return {
    id: row.evidence_id,
    file: row.evidence_file_path,
    kind: row.evidence_kind,
    snippet: truncateSnippet(redactSecrets(row.evidence_snippet), snippetChars),
    confidence: asConfidence(row.evidence_confidence),
    resourceUri: evidenceResourceUri(row.evidence_id),
    ...(row.evidence_start_line !== null ? { startLine: row.evidence_start_line } : {}),
    ...(row.evidence_end_line !== null ? { endLine: row.evidence_end_line } : {}),
    ...(row.evidence_start_col !== null ? { startCol: row.evidence_start_col } : {}),
    ...(row.evidence_end_col !== null ? { endCol: row.evidence_end_col } : {})
  };
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}