import { createHash } from "node:crypto";
import path from "node:path";
import { languageIdForPath } from "./entity-classification.js";

export const SCIP_IMPORT_ADAPTER_ID = 'scip-import';

export const SCIP_IMPORT_ADAPTER_VERSION = '0.1.0';

export const SCIP_EXPORT_TOOL_VERSION = '0.1.0';

export const SCIP_DEFINITION_ROLE = 0x1;

export const SCIP_READ_ACCESS_ROLE = 0x8;

export type ScipImportOptions = {
  repoRoot: string;
  file: string;
};

export type ScipImportResult = {
  indexRunId: number;
  adapterRunId: number;
  file: string;
  documentsImported: number;
  definitionsImported: number;
  referencesSeen: number;
  relationsImported: number;
  skippedReferences: number;
  warnings: string[];
};

export type ScipExportOptions = {
  repoRoot: string;
};

export type ScipExportResult = {
  indexRunId: number;
  documentsExported: number;
  symbolsExported: number;
  occurrencesExported: number;
  index: ScipIndexJson;
};

export type ScipIndexJson = {
  metadata: {
    version: 'UnspecifiedProtocolVersion';
    toolInfo: {
      name: 'parallax';
      version: string;
      arguments: string[];
    };
    projectRoot: string;
    textDocumentEncoding: 'UTF8';
  };
  documents: ScipExportDocument[];
};

export type ScipExportDocument = {
  relativePath: string;
  language: string;
  positionEncoding: 'UTF8CodeUnitOffsetFromLineStart';
  symbols: ScipExportSymbol[];
  occurrences: ScipExportOccurrence[];
};

export type ScipExportSymbol = {
  symbol: string;
  displayName: string;
  kind?: string;
};

export type ScipExportOccurrence = {
  symbol: string;
  symbolRoles: number;
  range?: [number, number, number] | [number, number, number, number];
};

export type ExportDocumentBucket = {
  path: string;
  language: string;
  symbols: Map<string, ScipExportSymbol>;
  occurrences: ScipExportOccurrence[];
};

export type ScipDocument = {
  path: string;
  language: string;
  content?: string;
  hash: string;
  existingFileId?: number;
  occurrences: Record<string, unknown>[];
  symbols: Record<string, unknown>[];
};

export type ScipImportSnapshot = {
  commitSha?: string;
  files: Map<string, { id: number; language: string; hash: string }>;
};

export type ScipDefinition = {
  symbol: string;
  path: string;
  language: string;
  displayName: string;
  symbolKind: string;
};

export type ScipReference = {
  sourcePath: string;
  targetPath: string;
  symbol: string;
  snippet: string;
  startLine?: number;
  endLine?: number;
  startCol?: number;
  endCol?: number;
};

export function parseScipJsonText(input: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!isRecord(parsed)) throw new Error('root is not an object');
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function addScipExportSymbol(
  document: ExportDocumentBucket,
  symbol: string,
  displayName: string,
  kind: string
): void {
  if (document.symbols.has(symbol)) return;
  const scipKind = scipKindFor(kind);
  document.symbols.set(symbol, {
    symbol,
    displayName,
    ...(scipKind ? { kind: scipKind } : {})
  });
}

export function scipSymbolForRelationTarget(row: {
  target_path: string;
  target_id: string;
  target_kind: string;
  target_symbol: string | null;
  target_display_name: string;
}): string {
  if (row.target_kind === 'symbol') {
    return scipCodeSymbol(
      row.target_path,
      firstNonEmpty(row.target_symbol ?? undefined, row.target_display_name),
      firstNonEmpty(symbolKindFromEntityId(row.target_id), row.target_kind)
    );
  }
  return scipFileSymbol(row.target_path);
}

export function scipRangeFromEvidence(row: {
  start_line: number | null;
  end_line: number | null;
  start_col: number | null;
  end_col: number | null;
}): { range?: [number, number, number] | [number, number, number, number] } {
  if (
    row.start_line === null ||
    row.start_col === null ||
    row.end_col === null
  ) {
    return {};
  }
  const startLine = Math.max(0, row.start_line - 1);
  const startCol = Math.max(0, row.start_col - 1);
  const endCol = Math.max(startCol, row.end_col - 1);
  if (row.end_line === null || row.end_line === row.start_line) {
    return { range: [startLine, startCol, endCol] };
  }
  return {
    range: [
      startLine,
      startCol,
      Math.max(startLine, row.end_line - 1),
      endCol
    ]
  };
}

export function scipFileSymbol(relativePath: string): string {
  return `parallax npm . . ${scipIdentifier(relativePath)}/`;
}

export function scipCodeSymbol(relativePath: string, name: string, kind: string): string {
  const suffix = scipDescriptorSuffix(kind);
  return `${scipFileSymbol(relativePath)}${scipIdentifier(name)}${suffix}`;
}

export function scipDescriptorSuffix(kind: string): string {
  const normalized = kind.toLowerCase();
  if (normalized.includes('class') || normalized.includes('interface') || normalized.includes('type')) return '#';
  if (normalized.includes('method') || normalized.includes('function') || normalized.includes('constructor')) return '().';
  return '.';
}

export function symbolKindFromEntityId(entityId: string): string | undefined {
  return /^symbol:[^:]*:.*#([^:]+):/.exec(entityId)?.[1];
}

export function scipIdentifier(value: string): string {
  return /^[A-Za-z0-9_$+-]+$/.test(value) ? value : `\`${value.replace(/`/g, '``')}\``;
}

export function scipKindFor(kind: string): string | undefined {
  const normalized = kind.toLowerCase();
  if (normalized.includes('file')) return 'File';
  if (normalized.includes('class')) return 'Class';
  if (normalized.includes('interface')) return 'Interface';
  if (normalized.includes('method')) return 'Method';
  if (normalized.includes('function')) return 'Function';
  if (normalized.includes('constructor')) return 'Constructor';
  if (normalized.includes('property')) return 'Property';
  if (normalized.includes('constant')) return 'Constant';
  if (normalized.includes('variable')) return 'Variable';
  if (normalized.includes('module')) return 'Module';
  if (normalized.includes('type')) return 'Type';
  return undefined;
}

export function loadScipDocuments(
  repoRoot: string,
  input: unknown[],
  snapshot: ScipImportSnapshot,
  warnings: string[],
  readScipGitBlob: (root: string, commitSha: string, file: string) => string | undefined
): ScipDocument[] {
  const documents: ScipDocument[] = [];
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) {
      warnings.push(`SCIP document skipped at index ${index}: expected object`);
      continue;
    }
    const rawPath = stringField(raw, 'relativePath', 'relative_path');
    if (!rawPath) {
      warnings.push(`SCIP document skipped at index ${index}: missing relativePath`);
      continue;
    }
    let relativePath: string;
    try {
      relativePath = normalizeScipRelativePath(rawPath);
    } catch (error) {
      warnings.push(`SCIP document skipped at index ${index}: ${errorMessage(error)}`);
      continue;
    }
    const indexed = snapshot.files.get(relativePath);
    const hasText = Object.prototype.hasOwnProperty.call(raw, 'text');
    let content: string | undefined;
    if (hasText) {
      if (typeof raw.text !== 'string') {
        warnings.push(`SCIP document skipped: ${relativePath}: text must be a string`);
        continue;
      }
      content = raw.text;
    } else if (!indexed && snapshot.commitSha) {
      content = readScipGitBlob(repoRoot, snapshot.commitSha, relativePath);
      if (content === undefined) {
        warnings.push(`SCIP document skipped: ${relativePath}: content unavailable at indexed Git commit`);
        continue;
      }
    } else if (!indexed) {
      warnings.push(`SCIP document skipped: ${relativePath}: content unavailable without embedded text or clean indexed Git commit`);
      continue;
    }
    const hash = content === undefined
      ? indexed!.hash
      : createHash('sha256').update(content).digest('hex');
    if (indexed && hash !== indexed.hash) {
      warnings.push(`SCIP document skipped: ${relativePath}: embedded text hash mismatch with indexed file`);
      continue;
    }
    const language = firstNonEmpty(
      stringField(raw, 'language'),
      indexed?.language,
      languageIdForPath(relativePath),
      'unknown'
    );
    documents.push({
      path: relativePath,
      language,
      ...(content !== undefined ? { content } : {}),
      hash,
      ...(indexed ? { existingFileId: indexed.id } : {}),
      occurrences: arrayField(raw, 'occurrences').filter(isRecord),
      symbols: arrayField(raw, 'symbols').filter(isRecord)
    });
  }
  return documents.sort((left, right) => left.path.localeCompare(right.path));
}

export function collectDefinitions(documents: readonly ScipDocument[]): Map<string, ScipDefinition> {
  const definitions = new Map<string, ScipDefinition>();
  for (const document of documents) {
    for (const info of document.symbols) {
      const symbol = stringField(info, 'symbol');
      if (!symbol) continue;
      definitions.set(symbol, {
        symbol,
        path: document.path,
        language: document.language,
        displayName: firstNonEmpty(stringField(info, 'displayName', 'display_name'), displayNameForSymbol(symbol)),
        symbolKind: firstNonEmpty(stringField(info, 'kind'), 'scip')
      });
    }
    for (const occurrence of document.occurrences) {
      const symbol = stringField(occurrence, 'symbol');
      if (!symbol || !isDefinitionOccurrence(occurrence) || definitions.has(symbol)) continue;
      definitions.set(symbol, {
        symbol,
        path: document.path,
        language: document.language,
        displayName: displayNameForSymbol(symbol),
        symbolKind: 'scip'
      });
    }
  }
  return definitions;
}

export function collectReferences(
  documents: readonly ScipDocument[],
  definitions: ReadonlyMap<string, ScipDefinition>
): { items: ScipReference[]; skipped: number } {
  const items: ScipReference[] = [];
  let skipped = 0;
  const documentByPath = new Map(documents.map((document) => [document.path, document]));
  for (const document of documents) {
    for (const occurrence of document.occurrences) {
      const symbol = stringField(occurrence, 'symbol');
      if (!symbol || isDefinitionOccurrence(occurrence)) continue;
      const target = definitions.get(symbol);
      if (!target) {
        skipped++;
        continue;
      }
      if (target.path === document.path) continue;
      const range = occurrenceRange(occurrence);
      items.push({
        sourcePath: document.path,
        targetPath: target.path,
        symbol,
        snippet: snippetForRange(documentByPath.get(document.path)?.content ?? '', range, symbol),
        ...(range
          ? {
            startLine: range.startLine + 1,
            endLine: range.endLine + 1,
            startCol: range.startChar + 1,
            endCol: range.endChar + 1
          }
          : {})
      });
    }
  }
  return { items, skipped };
}

export function normalizeScipRelativePath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\0')) throw new Error('invalid relativePath');
  if (/[\\\r\n]/.test(rawPath)) throw new Error(`relativePath must be canonical: ${rawPath}`);
  if (path.isAbsolute(rawPath)) throw new Error(`relativePath must not be absolute: ${rawPath}`);
  const normalized = rawPath;
  const parts = normalized.split('/');
  if (
    normalized !== path.posix.normalize(normalized)
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`relativePath must be canonical: ${rawPath}`);
  }
  return normalized;
}

export function resolveScipInputPath(repoRoot: string, inputPath: string): string {
  if (!inputPath || inputPath.includes('\0')) throw new Error('invalid path');
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(repoRoot, inputPath);
}

export function occurrenceRange(occurrence: Record<string, unknown>): {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
} | undefined {
  const singleLine = recordField(occurrence, 'singleLineRange', 'single_line_range');
  if (singleLine) {
    const line = integerField(singleLine, 'line');
    const startChar = integerField(singleLine, 'startCharacter', 'start_character');
    const endChar = integerField(singleLine, 'endCharacter', 'end_character');
    if (line !== undefined && startChar !== undefined && endChar !== undefined) {
      return { startLine: line, startChar, endLine: line, endChar };
    }
  }

  const multiLine = recordField(occurrence, 'multiLineRange', 'multi_line_range');
  if (multiLine) {
    const startLine = integerField(multiLine, 'startLine', 'start_line');
    const startChar = integerField(multiLine, 'startCharacter', 'start_character');
    const endLine = integerField(multiLine, 'endLine', 'end_line');
    const endChar = integerField(multiLine, 'endCharacter', 'end_character');
    if (
      startLine !== undefined &&
      startChar !== undefined &&
      endLine !== undefined &&
      endChar !== undefined
    ) {
      return { startLine, startChar, endLine, endChar };
    }
  }

  const range = arrayField(occurrence, 'range').map((item) =>
    typeof item === 'number' && Number.isInteger(item) ? item : undefined
  );
  if (range.length === 3 && range.every((item) => item !== undefined)) {
    return {
      startLine: range[0]!,
      startChar: range[1]!,
      endLine: range[0]!,
      endChar: range[2]!
    };
  }
  if (range.length === 4 && range.every((item) => item !== undefined)) {
    return {
      startLine: range[0]!,
      startChar: range[1]!,
      endLine: range[2]!,
      endChar: range[3]!
    };
  }
  return undefined;
}

export function snippetForRange(
  content: string,
  range: ReturnType<typeof occurrenceRange>,
  fallback: string
): string {
  if (!range) return fallback;
  const lines = content.split(/\r?\n/);
  const line = lines[range.startLine];
  if (line === undefined) return fallback;
  return line.trim() || fallback;
}

export function isDefinitionOccurrence(occurrence: Record<string, unknown>): boolean {
  const role = fieldValue(occurrence, 'symbolRoles', 'symbol_roles');
  if (typeof role === 'number') return (role & SCIP_DEFINITION_ROLE) > 0;
  if (typeof role === 'string') return role === 'Definition' || role.includes('Definition');
  if (Array.isArray(role)) return role.some((item) => item === 'Definition');
  return false;
}

export function languageIdsForDocuments(documents: readonly ScipDocument[]): string[] {
  return [...new Set(documents.map((document) => document.language))].sort();
}

export function relationId(kind: string, sourceEntityId: string, targetEntityId: string, provenance: string): string {
  return createHash('sha1')
    .update(`${kind}:${sourceEntityId}:${targetEntityId}:${provenance}`)
    .digest('hex')
    .slice(0, 20);
}

export function relationEvidenceId(
  relationIdValue: string,
  reference: ScipReference,
  snippet: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([
      relationIdValue,
      reference.sourcePath,
      snippet,
      reference.startLine ?? null,
      reference.endLine ?? null,
      reference.startCol ?? null,
      reference.endCol ?? null
    ]))
    .digest('hex')
    .slice(0, 20);
}

export function fileEntityId(relativePath: string): string {
  return `file:${relativePath}`;
}

export function scipSemanticId(definition: ScipDefinition): string {
  return `${definition.path}#scip:${definition.symbol}`;
}

export function displayNameForSymbol(symbol: string): string {
  const stripped = symbol.replace(/^local\s+/, '').trim();
  const match = /([A-Za-z0-9_$+-]+)(?:[#.(/:]|\(\)\.)?$/.exec(stripped);
  return match?.[1] ?? (stripped.slice(-80) || symbol);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}

export function arrayField(record: Record<string, unknown>, ...names: string[]): unknown[] {
  const value = fieldValue(record, ...names);
  return Array.isArray(value) ? value : [];
}

export function recordField(record: Record<string, unknown>, ...names: string[]): Record<string, unknown> | undefined {
  const value = fieldValue(record, ...names);
  return isRecord(value) ? value : undefined;
}

export function stringField(record: Record<string, unknown>, ...names: string[]): string | undefined {
  const value = fieldValue(record, ...names);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function integerField(record: Record<string, unknown>, ...names: string[]): number | undefined {
  const value = fieldValue(record, ...names);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function fieldValue(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value !== undefined && value.length > 0) return value;
  }
  return '';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function projectScipExport(indexRunId: number, documents: Map<string, ExportDocumentBucket>, projectRoot: string): ScipExportResult {
  const exportedDocuments = [...documents.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((document) => ({
      relativePath: document.path,
      language: document.language,
      positionEncoding: 'UTF8CodeUnitOffsetFromLineStart' as const,
      symbols: [...document.symbols.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)),
      occurrences: document.occurrences.sort((left, right) =>
        left.symbol.localeCompare(right.symbol) || JSON.stringify(left.range ?? []).localeCompare(JSON.stringify(right.range ?? []))
      )
    }));

  return {
    indexRunId,
    documentsExported: exportedDocuments.length,
    symbolsExported: exportedDocuments.reduce((sum, document) => sum + document.symbols.length, 0),
    occurrencesExported: exportedDocuments.reduce((sum, document) => sum + document.occurrences.length, 0),
    index: {
      metadata: {
        version: 'UnspecifiedProtocolVersion',
        toolInfo: {
          name: 'parallax',
          version: SCIP_EXPORT_TOOL_VERSION,
          arguments: ['parallax', 'scip', 'export']
        },
        projectRoot: projectRoot,
        textDocumentEncoding: 'UTF8'
      },
      documents: exportedDocuments
    }
  };
}
export type ScipRelationExportRow = {
  target_path: string;
  target_id: string;
  target_kind: string;
  target_symbol: string | null;
  target_display_name: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  start_col: number | null;
  end_col: number | null;
};

export function makeScipExportDocuments(rows: Array<{ path: string; language: string }>): Map<string, ExportDocumentBucket> {
  const documents = new Map<string, ExportDocumentBucket>();
  for (const row of rows) {
    const relativePath = normalizeScipRelativePath(row.path);
    const language = firstNonEmpty(row.language, languageIdForPath(relativePath), 'unknown');
    const symbols = new Map<string, ScipExportSymbol>();
    const fileSymbol = scipFileSymbol(relativePath);
    symbols.set(fileSymbol, {
      symbol: fileSymbol,
      displayName: relativePath,
      kind: 'File'
    });
    documents.set(relativePath, {
      path: relativePath,
      language,
      symbols,
      occurrences: []
    });
  }
  return documents;
}

export function appendScipExportSymbols(documents: Map<string, ExportDocumentBucket>, rows: Array<{ path: string; name: string; kind: string }>): void {
  for (const row of rows) {
    const document = documents.get(row.path);
    if (!document) continue;
    addScipExportSymbol(document, scipCodeSymbol(row.path, row.name, row.kind), row.name, row.kind);
  }
}

export function appendScipExportRelations(documents: Map<string, ExportDocumentBucket>, rows: ScipRelationExportRow[]): void {
  for (const row of rows) {
    if (!row.file_path) continue;
    const sourceDocument = documents.get(row.file_path);
    const targetDocument = documents.get(row.target_path);
    if (!sourceDocument || !targetDocument) continue;
    const targetSymbol = scipSymbolForRelationTarget(row);
    addScipExportSymbol(
      targetDocument,
      targetSymbol,
      firstNonEmpty(row.target_symbol ?? undefined, row.target_display_name, row.target_path),
      row.target_kind
    );
    sourceDocument.occurrences.push({
      symbol: targetSymbol,
      symbolRoles: SCIP_READ_ACCESS_ROLE,
      ...scipRangeFromEvidence(row)
    });
  }
}
