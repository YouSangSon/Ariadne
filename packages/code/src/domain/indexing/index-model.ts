import type { Confidence, IndexScanReads, ScannedFile } from "../model.js";
import type { IndexEvent, SemanticAdapter } from "./adapter.js";
import type { IndexRunFiles } from "./index-delta.js";

export type SkippedFile = {
  relativePath: string;
  language?: string;
  reason: string;
  contentSample?: string;
  contentSampleHash?: string;
};

export type ScanResult = {
  files: ScannedFile[];
  skipped: SkippedFile[];
  reads: IndexScanReads;
};

export type RelationEvidenceInput = {
  file: string;
  snippet: string;
  confidence: Confidence;
  startLine?: number;
  endLine?: number;
  startCol?: number;
  endCol?: number;
};

export type AdapterGroup = {
  adapter: SemanticAdapter;
  files: ScannedFile[];
  languageIds: string[];
};

export type CollectedIndexEvent = {
  adapter: SemanticAdapter;
  adapterRunId: number;
  adapterId: string;
  file: ScannedFile;
  event: IndexEvent;
};

export type CollectedIndexRun = {
  events: CollectedIndexEvent[];
  completedFilePathsByAdapterId: Map<string, Set<string>>;
  completedAdapterRuns: Array<{ adapterId: string; adapterRunId: number }>;
};

export type AdapterRunStatus = 'completed' | 'failed' | 'skipped';

export type PriorIndexRun = { runId: number; files: IndexRunFiles; inputSnapshotHash: string | null };