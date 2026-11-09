import type { IndexEvent, SemanticAdapter } from "../../domain/indexing/adapter.js";
import type { GitSnapshot } from "../../domain/indexing/git-snapshot.js";
import type { IndexDelta } from "../../domain/indexing/index-delta.js";
import type { AdapterGroup, AdapterRunStatus, CollectedIndexRun, PriorIndexRun, ScanResult, SkippedFile } from "../../domain/indexing/index-model.js";
import type { IndexOptions, IndexResult, ScannedFile } from "../../domain/model.js";

export interface ExtractionAudit {
  finish(id: number, status: AdapterRunStatus, message?: string): void;
  diagnostic(event: Extract<IndexEvent, { kind: 'diagnostic' }>, file: ScannedFile, adapterId: string, adapterRunId: number): void;
  skipCoverage(adapter: SemanticAdapter, files: readonly ScannedFile[], reason: string): void;
  skipUnstarted(groups: readonly AdapterGroup[], ids: ReadonlyMap<SemanticAdapter, number>, failedId: string): void;
}

export interface ExtractionPreparation {
  adapterGroups: readonly AdapterGroup[];
  skippedCoverage: ReadonlyArray<{ file: SkippedFile; adapterId: string }>;
  unsupportedFiles: readonly ScannedFile[];
  indexedCoverageFiles: readonly ScannedFile[];
  fileAdapterByPath: ReadonlyMap<string, SemanticAdapter>;
}

export interface IndexPublication {
  indexRunId: number;
  indexedFiles: readonly ScannedFile[];
  unsupportedFiles: readonly ScannedFile[];
  unsupportedLanguageIds: readonly string[];
  scan: ScanResult;
  adapterGroups: readonly AdapterGroup[];
  fileAdapterByPath: ReadonlyMap<string, SemanticAdapter>;
  collected: CollectedIndexRun;
  priorRun: PriorIndexRun | null;
  delta: IndexDelta;
  commitHistory: readonly (readonly string[])[];
  inputSnapshotHash: string;
}

export interface IndexingSession {
  reuseCleanIndex(snapshot: GitSnapshot, extractorVersion: string, options: IndexOptions): IndexResult | null;
  startRun(snapshot: GitSnapshot, extractorVersion: string): number;
  priorCompletedRun(): PriorIndexRun | null;
  prepareExtraction(indexRunId: number, input: ExtractionPreparation): Map<SemanticAdapter, number>;
  audit(indexRunId: number): ExtractionAudit;
  publish(input: IndexPublication): IndexResult;
  failRun(indexRunId: number, message: string): void;
  close(): void;
}

export interface IndexingPorts {
  normalizeRoot(root: string): string;
  openSession(root: string): IndexingSession;
  gitSnapshot(root: string): GitSnapshot;
  commitHistory(root: string): string[][];
  scanFiles(root: string, maxFileBytes: number): ScanResult;
}
