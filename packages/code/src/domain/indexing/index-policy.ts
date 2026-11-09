import { createHash } from "node:crypto";
import path from "node:path";
import { DATA_DIR } from "../branding.js";
import { contentHash } from "../identity.js";
import type { Confidence, EntityKind, RelationKind, ScannedFile } from "../model.js";
import { redactSecrets } from "../security/redaction.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { AdapterOutputOwnership, EntityDescriptor, IndexEvent, PendingRelation, SemanticAdapter } from "./adapter.js";
import { isJsonSchemaContractPath, languageIdForPath } from "./entity-classification.js";
import type { AdapterGroup, RelationEvidenceInput, ScanResult, SkippedFile } from "./index-model.js";

export const ignoredDirs = new Set([
  '.git', DATA_DIR, 'node_modules', 'dist', 'coverage',
  '.venv', 'venv', '__pycache__', 'site-packages',
  'target', 'vendor', 'build',
  '.tox', '.pytest_cache', '.mypy_cache', '.ruff_cache'
]);

export const defaultMaxFileBytes = 1_000_000;

export const skippedFileContentSampleBytes = 4_096;

export const unsupportedAdapterId = 'unsupported';

export function hashIndexInputs(scan: ScanResult, commitHistory: readonly (readonly string[])[]): string {
  const hash = createHash('sha256');
  for (const file of scan.files) {
    hash.update(JSON.stringify(['file', file.relativePath, file.language, file.hash])).update('\n');
  }
  for (const file of scan.skipped) {
    hash.update(JSON.stringify(['skipped', file.relativePath, file.language ?? null, file.reason,
      file.contentSample ?? null, file.contentSampleHash ?? null])).update('\n');
  }
  for (const commit of commitHistory) {
    hash.update(JSON.stringify(['commit', commit])).update('\n');
  }
  return `s1-input-v1:${hash.digest('hex')}`;
}

export function validateOutputOwnership(
  event: IndexEvent,
  file: ScannedFile,
  indexedPaths: ReadonlySet<string>,
  adapterId: string
): void {
  const owns = (entity: EntityDescriptor) =>
    entity.path === file.relativePath && fileEntityIdKinds.has(entity.kind);
  let valid: boolean;
  if (event.kind === 'entity') {
    valid = owns(event.entity);
  } else if (event.kind === 'diagnostic') {
    valid = event.file === file.relativePath;
  } else {
    const { source, target, evidence } = event.relation;
    const referencesIndexedFile = target.kind === 'file' && target.path !== undefined &&
      indexedPaths.has(target.path) && Object.keys(target).every((key) => key === 'kind' || key === 'path');
    valid = owns(source) && (owns(target) || referencesIndexedFile) &&
      (evidence ?? []).every((item) => item.file === file.relativePath);
  }
  if (!valid) {
    throw new Error(`adapter ${adapterId} violated processed-file output ownership for ${file.relativePath} (${event.kind})`);
  }
}

export function adapterConfidence(adapter: SemanticAdapter): Confidence {
  return adapter.confidence ?? 'unknown';
}

export function adapterKnownGaps(adapter: SemanticAdapter): string[] {
  return [...(adapter.knownGaps ?? [])];
}

export function immutableIndexedFilesSnapshot(
  files: readonly ScannedFile[]
): readonly Readonly<ScannedFile>[] {
  const snapshot = files.map((file) => Object.freeze({ ...file }));
  return Object.freeze(snapshot);
}

export function adapterGroupsInRegistryOrder(
  adapters: readonly SemanticAdapter[],
  classified: ReadonlyMap<SemanticAdapter, ScannedFile[]>,
  skippedCoverage: ReadonlyArray<{ file: SkippedFile; adapterId: string }> = []
): AdapterGroup[] {
  const skippedLanguageIdsByAdapter = new Map<string, Set<string>>();
  for (const { file, adapterId } of skippedCoverage) {
    if (adapterId === unsupportedAdapterId || !file.language) {
      continue;
    }
    let languageIds = skippedLanguageIdsByAdapter.get(adapterId);
    if (!languageIds) {
      languageIds = new Set<string>();
      skippedLanguageIdsByAdapter.set(adapterId, languageIds);
    }
    languageIds.add(file.language);
  }

  return adapters.flatMap((adapter) => {
    const files = classified.get(adapter) ?? [];
    const languageIds = new Set(languageIdsForFiles(files));
    for (const languageId of skippedLanguageIdsByAdapter.get(adapter.id) ?? []) {
      languageIds.add(languageId);
    }
    if (files.length === 0 && languageIds.size === 0) {
      return [];
    }
    return [
      {
        adapter,
        files,
        languageIds: [...languageIds].sort()
      }
    ];
  });
}

export function languageIdsForFiles(files: readonly ScannedFile[]): string[] {
  return [...new Set(files.map((file) => file.language))].sort();
}

export function adapterIdForSkippedFile(
  registry: AdapterRegistry,
  repoRoot: string,
  file: SkippedFile
): string {
  if (!file.language) {
    return unsupportedAdapterId;
  }
  const absolutePath = path.join(repoRoot, file.relativePath);
  const content = file.contentSample ?? '';
  const adapter = registry.pickAdapter({
    absolutePath,
    relativePath: file.relativePath,
    content,
    hash: file.contentSampleHash ?? createHash('sha256').update(content).digest('hex'),
    language: file.language
  });
  return adapter?.id ?? unsupportedAdapterId;
}

export function languageIdsForSkippedAndUnsupported(
  skippedCoverage: ReadonlyArray<{ file: SkippedFile; adapterId: string }>,
  unsupportedFiles: readonly ScannedFile[]
): string[] {
  return [
    ...new Set([
      ...unsupportedFiles.map((file) => file.language),
      ...skippedCoverage.flatMap(({ file, adapterId }) =>
        adapterId === unsupportedAdapterId && file.language ? [file.language] : []
      )
    ])
  ].sort();
}

export function extractorVersionFor(
  adapters: readonly SemanticAdapter[],
  outputOwnership: ReadonlyMap<SemanticAdapter, AdapterOutputOwnership>
): string {
  const semanticsRevision = `s1-output-ownership-carry-v2:${adapters.map((adapter) => outputOwnership.get(adapter)).join(',')}`;
  if (adapters.length === 1) {
    const adapter = adapters[0]!;
    return `${adapter.id}-${adapter.version}-${semanticsRevision}`;
  }
  return `${adapters.map((adapter) => `${adapter.id}-${adapter.version}`).join(',')}-${semanticsRevision}`;
}

export function pathBeforeDiagnosticMarker(filePath: string): string {
  return filePath.split('#diagnostic:')[0] ?? filePath;
}

export function isScannablePath(relativePath: string): boolean {
  if (relativePath.split('/').some((part) => ignoredDirs.has(part))) return false;
  return languageIdForPath(relativePath) !== undefined;
}

export function diagnosticReason(level: 'warn' | 'error', message: string): string {
  const label = level === 'warn' ? 'warning' : 'error';
  return `diagnostic ${label}: ${redactSecrets(message)}`;
}

export function diagnosticCoveragePath(
  filePath: string,
  level: 'warn' | 'error',
  reason: string
): string {
  return `${filePath}#diagnostic:${level}:${contentHash(level, reason).slice(0, 12)}`;
}

export function diagnosticLanguageId(filePath: string, currentFile: ScannedFile): string | null {
  if (filePath === currentFile.relativePath) {
    return currentFile.language;
  }
  return languageIdForPath(filePath) ?? null;
}

export function contractMetadataForPersistence(
  metadata: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const { compatibility: _compatibility, ...rest } = metadata;
  return rest;
}

export function compatibilityJsonForContractVersion(metadata: Readonly<Record<string, unknown>>): string {
  const compatibility = metadata.compatibility;
  return isJsonRecord(compatibility) ? stableJson(compatibility) : '{}';
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stringMetadata(
  metadata: Readonly<Record<string, unknown>>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function contractFileMetadata(
  relativePath: string,
  languageId: string
): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { path: relativePath };
  if (languageId === 'protobuf') {
    metadata.contractKind = 'protobuf';
  } else if (languageId === 'graphql') {
    metadata.contractKind = 'graphql';
  } else if (languageId === 'yaml' || languageId === 'json') {
    const contractKind = contractKindForPath(relativePath);
    if (contractKind) {
      metadata.contractKind = contractKind;
    }
  }
  return metadata;
}

export function contractKindForPath(relativePath: string): string | undefined {
  const basename = path.posix.basename(relativePath);
  const withoutExtension = basename.replace(/\.[^.]+$/, '').toLowerCase();
  if (withoutExtension.includes('asyncapi')) return 'asyncapi';
  if (withoutExtension.includes('swagger')) return 'openapi';
  if (withoutExtension.includes('openapi')) return 'openapi';
  if (isJsonSchemaContractPath(relativePath)) return 'json-schema';
  if (basename.toLowerCase().endsWith('.avsc')) return 'avro';
  return undefined;
}

export function entityVersionContentHash(
  entity: EntityDescriptor,
  ctx: { fileContentHashByPath: ReadonlyMap<string, string> },
  metadata?: Readonly<Record<string, unknown>>
): string {
  const containingFileContentHash = entity.path
    ? ctx.fileContentHashByPath.get(entity.path) ?? ''
    : '';
  if (entity.kind === 'symbol') {
    return symbolEntityVersionContentHash(entity, containingFileContentHash);
  }
  return contentHash(
    entity.kind,
    entity.languageId ?? '',
    entity.path ?? '',
    entity.symbolKind ?? '',
    entity.symbol ?? '',
    entity.displayName ?? '',
    stableJson(metadata ?? {}),
    containingFileContentHash
  );
}

export function symbolEntityVersionContentHash(
  entity: EntityDescriptor,
  containingFileContentHash: string
): string {
  return contentHash(
    entity.path ?? '',
    entity.symbolKind ?? '',
    entity.symbol ?? '',
    containingFileContentHash
  );
}

export function entityLocationJson(
  entity: EntityDescriptor,
  metadata?: Readonly<Record<string, unknown>>
): string {
  return stableJson({
    kind: entity.kind,
    path: entity.path ?? null,
    symbol: entity.symbol ?? null,
    symbolKind: entity.symbolKind ?? null,
    languageId: entity.languageId ?? null,
    displayName: entity.displayName ?? null,
    metadata: metadata ?? {}
  });
}

export function relationEvidenceForPersistence(
  relation: PendingRelation,
  file: ScannedFile,
  fallbackConfidence: Confidence
): RelationEvidenceInput[] {
  if (relation.evidence && relation.evidence.length > 0) {
    return relation.evidence.map((evidence) => ({
      file: evidence.file,
      snippet: evidence.snippet ?? '',
      confidence: evidence.confidence,
      ...(evidence.startLine !== undefined ? { startLine: evidence.startLine } : {}),
      ...(evidence.endLine !== undefined ? { endLine: evidence.endLine } : {}),
      ...(evidence.startCol !== undefined ? { startCol: evidence.startCol } : {}),
      ...(evidence.endCol !== undefined ? { endCol: evidence.endCol } : {})
    }));
  }
  return [
    {
      file: file.relativePath,
      snippet: file.content,
      confidence: fallbackConfidence
    }
  ];
}

export const fileEntityIdKinds = new Set<EntityKind>([
  'file',
  'test',
  'doc',
  'config',
  'policy',
  'proposal',
  'prd',
  'requirement',
  'decision',
  'workflow',
  'resource',
  'contract'
]);

export function entityIdFromDescriptor(
  d: EntityDescriptor,
  metadata?: Readonly<Record<string, unknown>>
): string {
  const descriptorMetadata = metadata ?? d.metadata;
  if (d.kind === 'symbol') {
    return `symbol:${d.languageId ?? ''}:${d.path ?? ''}#${d.symbolKind ?? ''}:${d.symbol ?? ''}`;
  }
  if (d.kind === 'external_entity') {
    return `external:${d.languageId ?? ''}:${externalEntityIdentityForId(d, descriptorMetadata)}`;
  }
  if (fileEntityIdKinds.has(d.kind)) {
    return fileEntityId(d.path ?? descriptorIdentityForId(d, descriptorMetadata));
  }
  return `${d.kind}:${d.languageId ?? ''}:${descriptorIdentityForId(d, descriptorMetadata)}`;
}

export function displayNameForEntityDescriptor(
  d: EntityDescriptor,
  entityId: string = entityIdFromDescriptor(d),
  metadata?: Readonly<Record<string, unknown>>
): string {
  const descriptorMetadata = metadata ?? d.metadata;
  return firstNonEmpty(
    d.displayName,
    d.symbol,
    d.path,
    externalSpecifier(descriptorMetadata),
    entityId
  );
}

export function externalEntityIdentityForId(
  d: EntityDescriptor,
  metadata?: Readonly<Record<string, unknown>>
): string {
  return firstNonEmpty(
    externalSpecifier(metadata),
    d.path,
    d.symbol,
    d.displayName,
    d.kind
  );
}

export function descriptorIdentityForId(
  d: EntityDescriptor,
  metadata?: Readonly<Record<string, unknown>>
): string {
  return firstNonEmpty(
    d.path,
    d.symbol,
    externalSpecifier(metadata),
    d.displayName,
    d.kind
  );
}

export function externalSpecifier(metadata?: Readonly<Record<string, unknown>>): string | undefined {
  const specifier = metadata?.specifier;
  return typeof specifier === 'string' ? specifier : undefined;
}

export function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return '';
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }
  return value;
}

export function legacyEdgeKindFor(canonical: RelationKind): string {
  if (canonical === 'DEPENDS_ON') return 'IMPORTS';
  if (canonical === 'VERIFIES') return 'TESTS';
  return canonical;
}

export function evidenceId(filePath: string, kind: string): string {
  return createHash('sha1').update(`${kind}:${filePath}`).digest('hex').slice(0, 16);
}

export function fileEntityId(relativePath: string): string {
  return `file:${relativePath}`;
}

export function relationId(
  kind: string,
  sourceEntityId: string,
  targetEntityId: string,
  provenance: string
): string {
  return createHash('sha1')
    .update(`${kind}:${sourceEntityId}:${targetEntityId}:${provenance}`)
    .digest('hex')
    .slice(0, 20);
}

export function relationEvidenceId(
  relationIdValue: string,
  evidence: RelationEvidenceInput,
  snippet: string
): string {
  const identity: unknown[] = [relationIdValue, evidence.file, snippet, evidence.confidence];
  if (snippet !== evidence.snippet) {
    identity.push({ rawSnippetHash: contentHash(evidence.snippet).slice(0, 20) });
  }
  if (hasEvidenceSpan(evidence)) {
    identity.push({
      startLine: evidence.startLine ?? null,
      endLine: evidence.endLine ?? null,
      startCol: evidence.startCol ?? null,
      endCol: evidence.endCol ?? null
    });
  }
  return createHash('sha1')
    .update(JSON.stringify(identity))
    .digest('hex')
    .slice(0, 20);
}

export function hasEvidenceSpan(evidence: RelationEvidenceInput): boolean {
  return (
    evidence.startLine !== undefined ||
    evidence.endLine !== undefined ||
    evidence.startCol !== undefined ||
    evidence.endCol !== undefined
  );
}

export const relationAttributeByKind: Record<RelationKind, string> = {
  DEPENDS_ON: 'imports',
  CALLS: 'calls',
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  IMPLEMENTS: 'implements',
  EXTENDS: 'extends',
  READS: 'reads',
  WRITES: 'writes',
  RAISES: 'raises',
  HANDLES: 'handles',
  OWNS: 'owns',
  TESTS: 'tests',
  VERIFIES: 'tests',
  DOCUMENTS: 'documents',
  CONFIGURES: 'configures',
  BREAKS_COMPATIBILITY_WITH: 'breaks_compat',
  REFERENCES: 'references',
  DECLARES: 'declares',
  GOVERNS: 'governs',
  PROPOSES: 'proposes',
  REQUIRES: 'requires',
  CO_CHANGES: 'co_changes'
};

export function relationKindToAttribute(kind: string): string {
  return relationAttributeByKind[kind as RelationKind] ?? kind.toLowerCase();
}