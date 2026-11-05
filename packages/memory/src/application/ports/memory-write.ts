import type { AddMemoryInput, IngestJob, SearchMemoryResult } from "../../domain/model/memory.js";
import type { ChunkEmbeddingConfig, EmbeddingClient, MemoryChunkRepository } from "./indexing.js";
import type { ArchiveRow, MemoryArchiveRepository } from "./memory-archive.js";
import type { CanonicalMemoryRepository, GoalRunRepository, IngestJobRepository } from "./memory-repositories.js";
import type { VectorIndex } from "./vector-index.js";


export type MemoryWriteScope = {
  repository: CanonicalMemoryRepository;
  chunkRepository: MemoryChunkRepository;
  ingestJobs: IngestJobRepository;
  archiveRepository: MemoryArchiveRepository;
  goalRuns: GoalRunRepository;
  embeddings: EmbeddingClient;
  embedding: ChunkEmbeddingConfig;
  vectorIndex: VectorIndex;
  writes: MemoryWriteCoordinator;
};

export type MemoryWriteCoordinator = {
  record<T>(organizationId: string, recordIds: readonly number[], work: (scope: MemoryWriteScope) => Promise<T>): Promise<T>;
  archive<T>(organizationId: string, archiveId: number, work: (scope: MemoryWriteScope) => Promise<T>): Promise<T>;
  create<T>(memory: AddMemoryInput, work: (scope: MemoryWriteScope, record: SearchMemoryResult, job: IngestJob) => Promise<T>): Promise<T>;
  // Call from an archive scope so lock order stays archive -> restored record.
  restore<T>(archive: ArchiveRow, organizationId: string, work: (scope: MemoryWriteScope, record: SearchMemoryResult, job: IngestJob) => Promise<T>): Promise<T>;
};
