import { createHash } from "node:crypto";
import { DATA_DIR } from "../branding.js";
import { contentHash } from "../identity.js";
import type { RememberValue } from "./model.js";

export type SessionImportFormat = 'codex' | 'claude';

export type SessionImportOptions = {
  repoRoot: string;
  file: string;
  format: SessionImportFormat;
  branch?: string;
  agent?: string;
};

export type SessionImportSource = {
  kind: 'repo' | 'external-explicit';
  path: string;
  bytes: number;
  sha256: string;
};

export type SessionImportResult = {
  sessionId: string;
  sessionEntityId: string;
  format: SessionImportFormat;
  source: SessionImportSource;
  messageCount: number;
  toolUseCount: number;
  referencedFiles: string[];
  summaryFactId: string;
  referenceFactIds: string[];
  factsWritten: number;
  warnings: string[];
};

export type ResolvedSessionFile = {
  absolutePath: string;
  source: Omit<SessionImportSource, 'sha256'>;
};

export type ParsedSession = {
  messageCount: number;
  toolUseCount: number;
  textForExtraction: string;
};

export const MAX_SESSION_BYTES = 1_000_000;

export const MAX_EXTRACT_TEXT_CHARS = 200_000;

export const MAX_REFERENCED_FILES = 100;

export function validateFormat(format: SessionImportFormat): void {
  if (format !== 'codex' && format !== 'claude') {
    throw new Error('import-session --format must be codex or claude');
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseSessionText(redacted: string, format: SessionImportFormat): ParsedSession {
  const lines = redacted.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const extracted: string[] = [];
  let parsedObjects = 0;
  let toolUseCount = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      parsedObjects++;
      collectStrings(parsed, extracted);
      if (looksLikeToolUse(parsed)) toolUseCount++;
    } catch {
      extracted.push(line);
      if (/tool[_-]?use|tool_call|function_call|apply_patch|exec_command|bash/i.test(line)) {
        toolUseCount++;
      }
    }
  }

  const joined = extracted.join('\n').slice(0, MAX_EXTRACT_TEXT_CHARS);
  return {
    messageCount: parsedObjects > 0 ? parsedObjects : lines.length,
    toolUseCount,
    textForExtraction: joined || `${format} session`
  };
}

export function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, output);
    }
  }
}

export function looksLikeToolUse(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const serialized = JSON.stringify(value).toLowerCase();
  return /tool[_-]?use|tool_call|function_call|apply_patch|exec_command|bash/.test(serialized);
}

export function sessionSummary(format: SessionImportFormat, parsed: ParsedSession, referencedFiles: string[]): string {
  const filePart =
    referencedFiles.length === 0
      ? 'no referenced repo files'
      : `${referencedFiles.length} referenced repo file(s): ${referencedFiles.slice(0, 5).join(', ')}`;
  return `Imported ${format} session with ${parsed.messageCount} event(s), ${parsed.toolUseCount} tool marker(s), ${filePart}.`;
}

export type PersistSessionInput = {
  sessionId: string;
  sessionEntityId: string;
  summaryValue: RememberValue;
  referencedFiles: string[];
  branch?: string;
  agent: string;
};

export type PersistSessionResult = {
  summaryFactId: string;
  referenceFactIds: string[];
  factsWritten: number;
};

export function factId(entity: string, attribute: string, valueBlob: string, branchId: string): string {
  return contentHash(entity, attribute, valueBlob, 'assert', branchId);
}
export function* sessionPathCandidates(text: string): Generator<string> {
  const pattern =
    /(?:^|[\s"'`([{])([A-Za-z0-9_@+./-]+)(?=$|[\s"'`)\]},:;])/g;
  for (const match of text.matchAll(pattern)) {
    const token = match[1]!;
    const segments = token.split('/');
    const fileName = segments[segments.length - 1]!;
    if (segments.some((segment) => segment.length === 0) || !fileName.slice(1, -1).includes('.')) continue;
    let end = token.length;
    while (token[end - 1] === '.') end--;
    const candidate = token.slice(0, end);
    if (!candidate || candidate.includes('\0')) continue;
    if (candidate.startsWith('../') || candidate.startsWith('/') || candidate.includes('://')) continue;
    if (
      candidate.startsWith(`${DATA_DIR}/`) ||
      candidate.includes(`/${DATA_DIR}/`)
    ) continue;
    if (candidate.startsWith('node_modules/') || candidate.includes('/node_modules/')) continue;
    yield candidate;
  }
}
