import type { ScopeRef, SearchMemoryResult } from "../../domain/model/memory.js";
import type { TextChunk } from "../../domain/policies/chunk-text.js";
import type { EmbeddingProvider } from "./embedding-provider.js";


export type ChunkEmbeddingConfig = {
  provider: string;
  model: string;
  dimensions: number;
  version: string;
  targetTokens: number;
  overlapTokens: number;
};

export type StoredMemoryChunk = {
  id: number;
  memoryRecordId: number;
  chunkIndex: number;
  content: string;
  startOffset: number;
  endOffset: number;
  embeddingVersion: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
};

export type PendingIngestJobRef = {
  id: number;
  qdrantAttempts: number;
};

export type ReindexableMemoryChunk = StoredMemoryChunk & {
  organizationId: string;
  scopeType: SearchMemoryResult["scopeType"];
  scopeId: string;
  projectKey: string | null;
  durability: string;
  kind: string;
  title?: string | null;
  summary?: string | null;
  tags?: string[];
  updatedAt: string;
};

export type ListChunksOptions = {
  afterChunkId?: number;
  limit?: number;
};

export type MemoryChunkRepository = {
  insertChunks(input: {
    record: SearchMemoryResult;
    chunks: TextChunk[];
    embedding: ChunkEmbeddingConfig;
  }): Promise<StoredMemoryChunk[]>;
  updatePointIds(
    mappings: Array<{ chunkId: number; qdrantPointId: string }>,
  ): Promise<void>;
  deleteChunksForRecord(recordId: number, organizationId: string): Promise<void>;
  replaceChunksForRecord?(input: {
    record: SearchMemoryResult;
    chunks: TextChunk[];
    embedding: ChunkEmbeddingConfig;
  }): Promise<StoredMemoryChunk[]>;
  replaceChunksForRecordWithPendingIngest?(input: {
    record: SearchMemoryResult;
    chunks: TextChunk[];
    embedding: ChunkEmbeddingConfig;
    nextRetryAt: Date;
    jobId?: number;
  }): Promise<{ chunks: StoredMemoryChunk[]; job: PendingIngestJobRef }>;
  listChunks(
    organizationId: string,
    scopes: ScopeRef[],
    options?: ListChunksOptions,
  ): Promise<ReindexableMemoryChunk[]>;
  // Fetch all chunks for a single memory record including the record-level
  // metadata needed to rebuild vector points. Used by the ingest sweeper to
  // re-index a specific record's chunks without scanning by scope.
  getChunksByRecordId(recordId: number): Promise<ReindexableMemoryChunk[]>;
  createContextPackRun(input: {
    organizationId: string;
    projectKey: string;
    task: string;
    selectedMemoryIds: string[];
    packMarkdown: string;
  }): Promise<void>;
};

export type EmbeddingClient = EmbeddingProvider;
