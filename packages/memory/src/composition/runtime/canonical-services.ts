// Canonical-services bootstrap + memoized resolver. Extracted from server.ts
// to keep that file focused on the registry/dispatch surface. The
// memoization pattern is load-bearing: if bootstrap fails, the cached promise
// is cleared so the next call can retry, but on success the singleton is
// reused for the lifetime of the process (saves a Postgres pool + migration
// run on every tool call).

import type {
  CanonicalServices
} from "../../application/contracts/tools.js";
import { createCanonicalServicesResolver as createResolver } from "../../application/tools/canonical-services.js";
import { resolveServiceConfig } from "../../infrastructure/configuration/config.js";
import { createAuditLogRepository } from "../../infrastructure/postgres/audit-log-repository.js";
import { createMemoryChunkRepository } from "../../infrastructure/postgres/canonical-indexing.js";
import { createPgPool } from "../../infrastructure/postgres/connection.js";
import { createGoalRunRepository } from "../../infrastructure/postgres/goal-run-repository.js";
import { createIngestJobRepository } from "../../infrastructure/postgres/ingest-job-repository.js";
import { createMemoryArchiveRepository } from "../../infrastructure/postgres/memory-archive-repository.js";
import { createMemoryRepository } from "../../infrastructure/postgres/memory-repository.js";
import { createMemoryWriteCoordinator } from "../../infrastructure/postgres/memory-write-coordinator.js";
import { runMigrations } from "../../infrastructure/postgres/migrate.js";
import { createQdrantClient } from "../../infrastructure/vector/client.js";
import { createPgVectorIndex } from "../../infrastructure/vector/pgvector-index.js";
import { createQdrantVectorIndex } from "../../infrastructure/vector/qdrant-index.js";
import { createEmbeddingProvider } from "./embedding-factory.js";

export async function bootstrapCanonicalServices(): Promise<CanonicalServices> {
  const config = resolveServiceConfig();
  const pool = createPgPool({
    connectionString: config.databaseUrl,
    ...config.postgres.pool,
  });

  try {
    await runMigrations(pool);

    let vectorIndex: CanonicalServices["vectorIndex"];

    if (config.vectorBackend === "pgvector") {
      const pgVectorIndex = createPgVectorIndex(pool);
      await pgVectorIndex.ensureCollection(config.embedding.dimensions);
      vectorIndex = pgVectorIndex;
    } else {
      const qdrantClient = createQdrantClient({
        url: config.qdrant.url,
        apiKey: config.qdrant.apiKey,
      });
      const qdrantVectorIndex = createQdrantVectorIndex(
        qdrantClient,
        config.qdrant.collectionName,
      );
      await qdrantVectorIndex.ensureCollection(config.embedding.dimensions);
      vectorIndex = qdrantVectorIndex;
    }

    const embeddings = createEmbeddingProvider({
      config: config.embedding,
      openaiApiKey: config.openai.apiKey,
    });
    const writes = createMemoryWriteCoordinator({
      pool,
      embeddings,
      embedding: {
        provider: config.embedding.provider,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        version: config.embedding.version,
        targetTokens: config.embedding.chunkTargetTokens,
        overlapTokens: config.embedding.chunkOverlapTokens,
      },
      vectorIndexForPool: config.vectorBackend === "pgvector"
        ? (scopedPool) => createPgVectorIndex(scopedPool)
        : () => vectorIndex,
    });

    return {
      config: {
        qdrant: {
          collectionName: config.qdrant.collectionName,
        },
        embedding: config.embedding,
      },
      repository: createMemoryRepository(pool),
      chunkRepository: createMemoryChunkRepository(pool),
      ingestJobs: createIngestJobRepository(pool),
      auditLog: createAuditLogRepository(pool),
      archiveRepository: createMemoryArchiveRepository(pool),
      goalRuns: createGoalRunRepository(pool),
      embeddings,
      writes,
      vectorIndex,
      close: async () => {
        await pool.end();
      },
    };
  } catch (error: unknown) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

export type { WithCanonicalServices } from "../../application/contracts/tools.js";
export { createServiceBackedAuditLog } from "../../application/tools/canonical-services.js";
export function createCanonicalServicesResolver(options: import("../../application/tools/canonical-services.js").CanonicalServicesResolverOptions) { return createResolver(options, bootstrapCanonicalServices); }

export type { CanonicalServicesResolverOptions } from "../../application/tools/canonical-services.js";
