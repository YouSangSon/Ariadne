import { createPendingIndexJob } from "../../application/indexing/pending-index-job.js";
import { type ChunkEmbeddingConfig, type EmbeddingClient } from "../../application/ports/indexing.js";
import type { MemoryWriteCoordinator, MemoryWriteScope } from "../../application/ports/memory-write.js";
import type { VectorIndex } from "../../application/ports/vector-index.js";
import type { IngestJob, SearchMemoryResult } from "../../domain/model/memory.js";
import { createMemoryChunkRepository } from "./canonical-indexing.js";
import type { PgPool } from "./connection.js";
import { createGoalRunRepository } from "./goal-run-repository.js";
import { createIngestJobRepository } from "./ingest-job-repository.js";
import { createMemoryArchiveRepository } from "./memory-archive-repository.js";
import { createMemoryRepository } from "./memory-repository.js";
import { withPgSession } from "./record-lock.js";

type CoordinatorInput = {
  pool: PgPool;
  vectorIndexForPool(pool: PgPool): VectorIndex;
  embeddings: EmbeddingClient;
  embedding: ChunkEmbeddingConfig;
};

export function createMemoryWriteCoordinator(input: CoordinatorInput): MemoryWriteCoordinator {
  function createScope(pool: PgPool, assertUsable: () => void): MemoryWriteScope {
    const vectorIndex = input.vectorIndexForPool(pool);
    return {
      repository: createMemoryRepository(pool),
      chunkRepository: createMemoryChunkRepository(pool),
      ingestJobs: createIngestJobRepository(pool),
      archiveRepository: createMemoryArchiveRepository(pool),
      goalRuns: createGoalRunRepository(pool),
      embeddings: input.embeddings,
      embedding: input.embedding,
      vectorIndex: {
        ensureCollection: (dimensions) => { assertUsable(); return vectorIndex.ensureCollection(dimensions); },
        query: (vector, filter, limit) => { assertUsable(); return vectorIndex.query(vector, filter, limit); },
        upsert: (points) => { assertUsable(); return vectorIndex.upsert(points); },
        delete: (ids, options) => { assertUsable(); return vectorIndex.delete(ids, options); },
        deleteByRecordIds: (ids, options) => { assertUsable(); return vectorIndex.deleteByRecordIds(ids, options); },
      },
      writes: createMemoryWriteCoordinator({ ...input, pool }),
    };
  }

  return {
    async record(organizationId, recordIds, work) {
      const ids = [...new Set(recordIds)].sort((a, b) => a - b);
      if (ids.length === 0) throw new Error("record write requires a record id");
      const keys = ids.map((id) => lockKey("record", organizationId, id));
      return withPgSession(input.pool, async (session) => {
        for (const key of keys) await session.lock(key);
        return work(createScope(session.pool, session.assertUsable));
      });
    },
    async archive(organizationId, archiveId, work) {
      return withPgSession(input.pool, async (session) => {
        await session.lock(lockKey("archive", organizationId, archiveId));
        return work(createScope(session.pool, session.assertUsable));
      });
    },
    async create(memory, work) {
      const organizationId = memory.organizationId?.trim() ?? "default";
      return withPgSession(input.pool, async (session) => {
        const scope = createScope(session.pool, session.assertUsable);
        let job: IngestJob | undefined;
        const record = await scope.repository.addMemory(memory, async (created) => {
          // Acquire the new ID before it becomes visible; compensation stays under this lock.
          await session.lock(lockKey("record", organizationId, created.id));
          job = await createPendingIndexJob(scope.ingestJobs, created.id, organizationId);
        });
        if (!job) throw new Error("initial indexing intent was not committed");
        return work(scope, record, job);
      });
    },
    async restore(archive, organizationId, work) {
      return withPgSession(input.pool, async (session) => {
        const scope = createScope(session.pool, session.assertUsable);
        let job: IngestJob | undefined;
        let record: SearchMemoryResult | null = null;
        await scope.archiveRepository.restoreToCanonical(archive, organizationId, async (id) => {
          await session.lock(lockKey("record", organizationId, id));
          job = await createPendingIndexJob(scope.ingestJobs, id, organizationId);
          await scope.archiveRepository.markUnarchived(archive.id);
          record = await scope.repository.getMemoryRecordById(id, organizationId);
          if (!record) throw new Error("restored canonical memory was not found");
        });
        if (!job || !record) throw new Error("restore indexing intent was not committed");
        return work(scope, record, job);
      });
    },
  };
}

function lockKey(kind: "record" | "archive", organizationId: string, id: number): string {
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    throw new Error("organizationId must contain non-whitespace text");
  }
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("write lock id must be a positive safe integer");
  return JSON.stringify(["akasha", kind, organizationId.trim(), id]);
}
export { type MemoryWriteCoordinator, type MemoryWriteScope } from "../../application/ports/memory-write.js";
