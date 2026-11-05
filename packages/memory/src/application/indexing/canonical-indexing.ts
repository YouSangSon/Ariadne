import type { AddMemoryInput, IngestJob, ScopeRef, SearchMemoryResult } from "../../domain/model/memory.js";
import type { TextChunk } from "../../domain/policies/chunk-text.js";
import { assertNonBlankMemoryContent, assertNonBlankText } from "../../domain/policies/memory-content.js";
import { nextRetryDelayMs } from "../../domain/policies/retry-backoff.js";
import { normalizeScopeRefs } from "../../domain/policies/scope.js";
import { scanForSecrets, SecretDetectedError } from "../../domain/policies/secret-scrub.js";
import type { ChunkEmbeddingConfig, EmbeddingClient, MemoryChunkRepository, PendingIngestJobRef, ReindexableMemoryChunk, StoredMemoryChunk } from "../ports/indexing.js";
import type { CanonicalMemoryRepository, IngestJobRepository } from "../ports/memory-repositories.js";
import type { MemoryWriteCoordinator } from "../ports/memory-write.js";
import type { VectorIndex, VectorPoint } from "../ports/vector-index.js";
import { chunkForEmbedding } from "./chunk-for-embedding.js";
import { buildVectorPoint } from "./point-builder.js";


export async function refreshCanonicalMemoryIndex(input: {
  chunkRepository: MemoryChunkRepository;
  ingestJobs?: IngestJobRepository;
  embeddings: EmbeddingClient;
  vectorIndex: VectorIndex;
  embedding: ChunkEmbeddingConfig;
  record: SearchMemoryResult;
  job?: PendingIngestJobRef;
  reuseUnchangedChunks?: boolean;
  manageFailure?: boolean;
}): Promise<{ chunkCount: number }> {
  const recordOrganizationId = input.record.organizationId ?? "default";
  assertNonBlankText(recordOrganizationId, "organizationId");
  const organizationId = recordOrganizationId.trim();
  let job: PendingIngestJobRef | null = input.job ?? null;

  if (input.record.durability === "archived") {
    if (input.ingestJobs && !job) {
      job = await input.ingestJobs.create({ memoryRecordId: input.record.id, organizationId });
      await input.ingestJobs.markQdrantPending({
        jobId: job.id,
        attempts: job.qdrantAttempts,
        nextRetryAt: new Date(Date.now() + nextRetryDelayMs(job.qdrantAttempts)),
      });
    }
    await input.vectorIndex.deleteByRecordIds([input.record.id], {
      organizationId,
    });
    if (job && input.ingestJobs) {
      await input.ingestJobs.markCompleted(job.id);
      await input.ingestJobs.markQdrantCompleted(job.id);
    }
    return { chunkCount: 0 };
  }

  const chunks = await chunkForEmbedding({
    text: input.record.content,
    targetTokens: input.embedding.targetTokens,
    overlapTokens: input.embedding.overlapTokens,
  }, input.embeddings);
  const embeddings = chunks.length === 0
    ? []
    : await input.embeddings.embedBatch(chunks.map((chunk) => chunk.content));
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `refresh embedBatch returned ${embeddings.length} vectors for ${chunks.length} chunks`,
    );
  }

  try {
    const retryAt = new Date(Date.now() + nextRetryDelayMs(0));
    let storedChunks: StoredMemoryChunk[];
    const existing = input.reuseUnchangedChunks
      ? await input.chunkRepository.getChunksByRecordId(input.record.id)
      : [];
    if (input.reuseUnchangedChunks && sameChunkLayout(existing, chunks, input.embedding)) {
      storedChunks = existing;
      if (input.ingestJobs && !job) {
        job = await input.ingestJobs.create({ memoryRecordId: input.record.id, organizationId });
        await input.ingestJobs.markQdrantPending({
          jobId: job.id,
          attempts: job.qdrantAttempts,
          nextRetryAt: retryAt,
        });
      }
    } else if (input.ingestJobs) {
      if (!input.chunkRepository.replaceChunksForRecordWithPendingIngest) {
        throw new Error(
          "refreshCanonicalMemoryIndex requires atomic chunk replacement with pending ingest",
        );
      }
      const replaced =
        await input.chunkRepository.replaceChunksForRecordWithPendingIngest({
          record: input.record,
          chunks,
          embedding: input.embedding,
          nextRetryAt: retryAt,
          ...(job ? { jobId: job.id } : {}),
        });
      job = replaced.job;
      storedChunks = replaced.chunks;
    } else {
      storedChunks = input.chunkRepository.replaceChunksForRecord !== undefined
        ? await input.chunkRepository.replaceChunksForRecord({
          record: input.record,
          chunks,
          embedding: input.embedding,
        })
        : await replaceChunksForRecordFallback(input.chunkRepository, {
          organizationId,
          record: input.record,
          chunks,
          embedding: input.embedding,
        });
    }

    const points: VectorPoint[] = storedChunks.map((chunk, index) =>
      buildVectorPoint({
        chunkId: chunk.id,
        vector: embeddings[index] ?? [],
        memoryRecordId: input.record.id,
        organizationId,
        scopeType: input.record.scopeType,
        scopeId: input.record.scopeId,
        projectKey: input.record.projectKey ?? null,
        kind: input.record.memoryType,
        durability: input.record.durability ?? "ephemeral",
        title: input.record.title ?? null,
        summary: input.record.summary ?? null,
        tags: input.record.tags ?? [],
        updatedAt: input.record.updatedAt,
        embeddingVersion: chunk.embeddingVersion,
      }),
    );

    await input.vectorIndex.deleteByRecordIds([input.record.id], {
      organizationId,
    });

    if (points.length > 0) {
      let upsertedPointIds: string[] = [];
      await input.vectorIndex.upsert(points);
      upsertedPointIds = points.map((point) => point.id);
      try {
        await input.chunkRepository.updatePointIds(
          points.map((point, index) => ({
            chunkId: storedChunks[index]!.id,
            qdrantPointId: point.id,
          })),
        );
      } catch (error: unknown) {
        await input.vectorIndex.delete(upsertedPointIds, { organizationId })
          .catch(() => undefined);
        throw error;
      }
    }

    if (job) {
      await input.ingestJobs!.markCompleted(job.id);
      await input.ingestJobs!.markQdrantCompleted(job.id);
    }

    return { chunkCount: storedChunks.length };
  } catch (error: unknown) {
    if (job && input.manageFailure !== false) {
      try {
        await input.ingestJobs!.markQdrantPending({
          jobId: job.id,
          attempts: job.qdrantAttempts,
          nextRetryAt: new Date(Date.now() + nextRetryDelayMs(job.qdrantAttempts)),
          error,
        });
      } catch (_err: unknown) {
        // Preserve the original refresh failure; losing the retry marker is a
        // secondary outage and should not mask the vector/chunk error.
      }
    }
    throw error;
  }
}

export type WriteCanonicalMemoryInput = {
  repository: CanonicalMemoryRepository;
  chunkRepository: MemoryChunkRepository;
  ingestJobs: IngestJobRepository;
  embeddings: EmbeddingClient;
  vectorIndex: VectorIndex;
  embedding: ChunkEmbeddingConfig;
  memory: AddMemoryInput;
  writes?: MemoryWriteCoordinator;
};

export async function writeCanonicalMemory(input: WriteCanonicalMemoryInput): Promise<SearchMemoryResult> {
  assertNonBlankMemoryContent(input.memory.content);

  // Guard: refuse to persist user-supplied text that looks like a credential.
  // Scans every user-controlled field (content + title + summary) and throws
  // a single SecretDetectedError with the union of categories found, so the
  // operator gets a complete picture in one error rather than a sequence of
  // throws. Throwing here means no record row, no chunk row, no qdrant point,
  // no ingest job. The error carries categories only, never the matched value.
  const detections = [
    ...scanForSecrets(input.memory.content),
    ...(input.memory.title ? scanForSecrets(input.memory.title) : []),
    ...(input.memory.summary ? scanForSecrets(input.memory.summary) : []),
  ];
  if (detections.length > 0) {
    throw new SecretDetectedError(detections.map((d) => d.category));
  }

  if (input.writes) {
    return input.writes.create(input.memory, (scope, record, job) =>
      indexCreatedMemory({ ...input, ...scope }, record, job));
  }

  const record = await input.repository.addMemory(input.memory);
  const organizationId = record.organizationId ?? "default";
  assertNonBlankText(organizationId, "organizationId");

  const job = await input.ingestJobs.create({
    memoryRecordId: record.id,
    organizationId,
  });
  return indexCreatedMemory(input, record, job);
}

async function indexCreatedMemory(
  input: WriteCanonicalMemoryInput,
  record: SearchMemoryResult,
  job: IngestJob,
): Promise<SearchMemoryResult> {
  const organizationId = record.organizationId ?? "default";
  let upsertedPointIds: string[] = [];
  let vectorWriteAttempted = false;

  try {
    const chunks = await chunkForEmbedding({
      text: record.content,
      targetTokens: input.embedding.targetTokens,
      overlapTokens: input.embedding.overlapTokens,
    }, input.embeddings);
    const storedChunks = await input.chunkRepository.insertChunks({
      record,
      chunks,
      embedding: input.embedding,
    });

    // Write-ahead: record the intent to index BEFORE touching Qdrant. If the
    // process crashes between here and markQdrantCompleted, the job row is left
    // with qdrant_status='pending' and a scheduled qdrant_next_retry_at so the
    // ingest sweeper can re-index the already-committed chunks automatically.
    // Guard: skip write-ahead when there are no chunks (empty content) — nothing
    // to re-index, and markCompleted below handles the overall job close-out.
    if (storedChunks.length > 0) {
      await input.ingestJobs.markQdrantPending({
        jobId: job.id,
        attempts: 0,
        nextRetryAt: new Date(Date.now() + nextRetryDelayMs(0)),
      });
    }

    const embeddings = await input.embeddings.embedBatch(
      storedChunks.map((chunk) => chunk.content),
    );
    if (embeddings.length !== storedChunks.length) {
      throw new Error(
        `embedBatch returned ${embeddings.length} vectors for ${storedChunks.length} chunks`,
      );
    }
    const points: VectorPoint[] = storedChunks.map((chunk, index) =>
      buildVectorPoint({
        chunkId: chunk.id,
        vector: embeddings[index] ?? [],
        memoryRecordId: record.id,
        organizationId,
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        projectKey: record.projectKey ?? null,
        kind: record.memoryType,
        durability: record.durability ?? "ephemeral",
        title: record.title ?? null,
        summary: record.summary ?? null,
        tags: record.tags ?? [],
        updatedAt: record.updatedAt,
        embeddingVersion: chunk.embeddingVersion,
      }),
    );

    if (points.length > 0) {
      vectorWriteAttempted = true;
      await input.vectorIndex.upsert(points);
      upsertedPointIds = points.map((point) => point.id);
      await input.chunkRepository.updatePointIds(
        points.map((point, index) => ({
          chunkId: storedChunks[index]!.id,
          qdrantPointId: point.id,
        })),
      );
    }

    await input.ingestJobs.markCompleted(job.id);
    if (points.length > 0) {
      // Clear the retry intent last so compensation can still be recovered.
      await input.ingestJobs.markQdrantCompleted(job.id);
    }

    return record;
  } catch (error: unknown) {
    if (input.writes && vectorWriteAttempted) {
      try {
        await input.vectorIndex.deleteByRecordIds([record.id], { organizationId });
      } catch (_cleanupError: unknown) {
        // Keep the committed pending intent if partial vector writes cannot be removed.
        throw error;
      }
    }
    // Rollback the partial PG state. Schema-level ON DELETE CASCADE removes
    // memory_chunks, ingest_jobs (including this job row), and relationships
    // in the same statement. If vector points became visible before a later
    // SQL/job step failed, delete those points too. Cleanup is best-effort:
    // if it itself fails, the original error still surfaces to the caller.
    if (!input.writes && upsertedPointIds.length > 0) {
      await input.vectorIndex.delete(upsertedPointIds).catch(() => undefined);
    }
    await input.repository.deleteMemoryRecord(record.id, organizationId).catch(() => undefined);
    throw error;
  }
}

export async function reindexCanonicalMemory(input: {
  repository?: CanonicalMemoryRepository;
  writes?: MemoryWriteCoordinator;
  chunkRepository: MemoryChunkRepository;
  embeddings: EmbeddingClient;
  vectorIndex: VectorIndex;
  organizationId: string;
  scopes: ScopeRef[];
  batchSize?: number;
}): Promise<{ chunkCount: number }> {
  assertNonBlankText(input.organizationId, "organizationId");
  const organizationId = input.organizationId.trim();
  const reindexInput = { ...input, organizationId };

  const batchSize = normalizeReindexBatchSize(input.batchSize);
  if (input.writes) {
    if (!input.repository?.listMemoryRecordIdsForIndexing) {
      throw new Error("canonical reindex requires record-ID pagination");
    }
    const scopes = normalizeScopeRefs(input.scopes, "scopes");
    let afterId: number | undefined;
    let throughId: number | undefined;
    let chunkCount = 0;
    while (true) {
      const page = await input.repository.listMemoryRecordIdsForIndexing(
        organizationId, scopes, { afterId, throughId, limit: batchSize },
      );
      throughId ??= page.throughId;
      if (page.ids.length === 0) break;
      for (const id of page.ids) {
        chunkCount += await input.writes.record(organizationId, [id], async (scope) => {
          const record = await scope.repository.getMemoryRecordById(id, organizationId);
          if (!record || record.id !== id || record.organizationId !== organizationId
            || !scopes.some((ref) => ref.scopeType === record.scopeType && ref.scopeId === record.scopeId)) {
            return 0;
          }
          const result = await refreshCanonicalMemoryIndex({
            ...scope, record, reuseUnchangedChunks: true,
          });
          return result.chunkCount;
        });
      }
      afterId = page.ids[page.ids.length - 1]!;
      if (afterId >= throughId) break;
    }
    return { chunkCount };
  }

  let foundChunks = false;

  await forEachReindexChunkPage(reindexInput, batchSize, async (chunks) => {
    foundChunks = true;
    await input.vectorIndex.deleteByRecordIds(
      [...new Set(chunks.map((chunk) => chunk.memoryRecordId))],
      { organizationId },
    );
  });

  if (!foundChunks) {
    return { chunkCount: 0 };
  }

  // Clear stale vectors for every page before any upsert starts. Deleting after
  // a page has been reinserted is unsafe when one memory record spans pages: a
  // later delete for that same record could erase vectors inserted earlier.
  let chunkCount = 0;
  await forEachReindexChunkPage(reindexInput, batchSize, async (page) => {
    const chunks = page.filter((chunk) => chunk.durability !== "archived");
    if (chunks.length === 0) return;

    const embeddings = await input.embeddings.embedBatch(
      chunks.map((chunk) => chunk.content),
    );
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `reindex embedBatch returned ${embeddings.length} vectors for ${chunks.length} chunks`,
      );
    }
    const points: VectorPoint[] = chunks.map((chunk, index) =>
      buildVectorPoint({
        chunkId: chunk.id,
        vector: embeddings[index] ?? [],
        memoryRecordId: chunk.memoryRecordId,
        organizationId: chunk.organizationId,
        scopeType: chunk.scopeType,
        scopeId: chunk.scopeId,
        projectKey: chunk.projectKey,
        kind: chunk.kind,
        durability: chunk.durability,
        title: chunk.title ?? null,
        summary: chunk.summary ?? null,
        tags: chunk.tags ?? [],
        updatedAt: chunk.updatedAt,
        embeddingVersion: chunk.embeddingVersion,
      }),
    );

    await input.vectorIndex.upsert(points);
    await input.chunkRepository.updatePointIds(
      points.map((point, index) => ({
        chunkId: chunks[index]!.id,
        qdrantPointId: point.id,
      })),
    );
    chunkCount += chunks.length;
  });

  return { chunkCount };
}

async function forEachReindexChunkPage(
  input: {
    chunkRepository: MemoryChunkRepository;
    organizationId: string;
    scopes: ScopeRef[];
  },
  batchSize: number,
  onPage: (chunks: ReindexableMemoryChunk[]) => Promise<void> | void,
): Promise<void> {
  let afterChunkId: number | undefined;
  while (true) {
    const chunks = await input.chunkRepository.listChunks(
      input.organizationId,
      input.scopes,
      afterChunkId === undefined
        ? { limit: batchSize }
        : { afterChunkId, limit: batchSize },
    );
    if (chunks.length === 0) {
      return;
    }

    await onPage(chunks);
    afterChunkId = chunks[chunks.length - 1]!.id;
    if (chunks.length < batchSize) {
      return;
    }
  }
}

function normalizeReindexBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) {
    return 500;
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("reindex batchSize must be a positive integer");
  }
  return Math.min(batchSize, 5_000);
}

function sameChunkLayout(stored: StoredMemoryChunk[], desired: TextChunk[], embedding: ChunkEmbeddingConfig): boolean {
  return stored.length === desired.length && stored.every((chunk, index) => {
    const next = desired[index]!;
    return chunk.chunkIndex === next.chunkIndex && chunk.content === next.content
      && chunk.startOffset === next.startOffset && chunk.endOffset === next.endOffset
      && chunk.embeddingProvider === embedding.provider && chunk.embeddingModel === embedding.model
      && chunk.embeddingDimensions === embedding.dimensions && chunk.embeddingVersion === embedding.version;
  });
}

async function replaceChunksForRecordFallback(
  chunkRepository: MemoryChunkRepository,
  input: {
    organizationId: string;
    record: SearchMemoryResult;
    chunks: TextChunk[];
    embedding: ChunkEmbeddingConfig;
  },
): Promise<StoredMemoryChunk[]> {
  await chunkRepository.deleteChunksForRecord(input.record.id, input.organizationId);
  return chunkRepository.insertChunks({
    record: input.record,
    chunks: input.chunks,
    embedding: input.embedding,
  });
}
