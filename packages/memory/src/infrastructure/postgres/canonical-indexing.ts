import type { ChunkEmbeddingConfig, ListChunksOptions, MemoryChunkRepository, ReindexableMemoryChunk, StoredMemoryChunk } from "../../application/ports/indexing.js";
import type { ScopeRef, SearchMemoryResult } from "../../domain/model/memory.js";
import type { TextChunk } from "../../domain/policies/chunk-text.js";
import {
  assertNonBlankText
} from "../../domain/policies/memory-content.js";
import { normalizeScopeRefs } from "../../domain/policies/scope.js";
import type { PgPool, PgQueryable } from "./connection.js";
import { requireSingleRow, toIsoString, toNumber } from "./db-utils.js";

type StoredMemoryChunkRow = {
  id: number | string;
  memory_record_id: number | string;
  chunk_index: number | string;
  content: string;
  start_offset: number | string;
  end_offset: number | string;
  embedding_version: string;
  embedding_provider?: string;
  embedding_model?: string;
  embedding_dimensions?: number | string;
};

type ReindexableMemoryChunkRow = StoredMemoryChunkRow & {
  organization_id: string;
  scope_type: unknown;
  scope_id: string;
  project_key: string | null;
  durability: unknown;
  kind: unknown;
  title: string | null;
  summary: string | null;
  tags: string[] | null;
  updated_at: string | Date;
};

export function createMemoryChunkRepository(pool: PgPool): MemoryChunkRepository {
  assertMemoryChunkPool(pool);

  return {
    async insertChunks(input) {
      return insertPostgresChunks(pool, input);
    },

    async updatePointIds(mappings) {
      assertPointIdMappings(mappings);

      if (mappings.length === 0) {
        return;
      }

      // Build a single UPDATE...FROM VALUES so all mappings are applied in one
      // round-trip. Types must be cast explicitly: id is bigint, pid is text.
      const params: unknown[] = [];
      const valueClauses: string[] = [];

      for (const mapping of mappings) {
        const base = params.length;
        params.push(mapping.chunkId, mapping.qdrantPointId);
        valueClauses.push(`($${base + 1}::bigint,$${base + 2}::text)`);
      }

      await pool.query(
        `
          UPDATE memory_chunks AS m
          SET qdrant_point_id = v.pid
          FROM (VALUES ${valueClauses.join(",")}) AS v(id, pid)
          WHERE m.id = v.id
        `,
        params,
      );
    },

    async deleteChunksForRecord(recordId, organizationId) {
      assertPositiveSafeInteger(recordId, "recordId");
      assertNonBlankText(organizationId, "organizationId");
      const scopedOrganizationId = organizationId.trim();

      await pool.query(
        `
          DELETE FROM memory_chunks
          WHERE memory_record_id = $1
            AND organization_id = $2
        `,
        [recordId, scopedOrganizationId],
      );
    },

    async replaceChunksForRecord(input) {
      assertChunkWriteInput(input);
      const rawOrganizationId = input.record.organizationId ?? "default";
      assertNonBlankText(rawOrganizationId, "organizationId");
      const organizationId = rawOrganizationId.trim();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `
            DELETE FROM memory_chunks
            WHERE memory_record_id = $1
              AND organization_id = $2
          `,
          [input.record.id, organizationId],
        );
        const chunks = await insertPostgresChunks(client, input);
        await client.query("COMMIT");
        return chunks;
      } catch (error: unknown) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async replaceChunksForRecordWithPendingIngest(input) {
      assertReplaceChunksWithPendingIngestInput(input);
      const rawOrganizationId = input.record.organizationId ?? "default";
      assertNonBlankText(rawOrganizationId, "organizationId");
      const organizationId = rawOrganizationId.trim();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `
            DELETE FROM memory_chunks
            WHERE memory_record_id = $1
              AND organization_id = $2
          `,
          [input.record.id, organizationId],
        );
        const chunks = await insertPostgresChunks(client, input);
        const jobResult = input.jobId !== undefined
          ? await client.query<{ id: number | string; qdrant_attempts: number | string }>(
            `UPDATE ingest_jobs SET status = 'pending', qdrant_status = 'pending',
              qdrant_next_retry_at = $4, updated_at = NOW()
             WHERE id = $1 AND memory_record_id = $2 AND organization_id = $3
               AND qdrant_status = 'pending'
             RETURNING id, qdrant_attempts`,
            [input.jobId, input.record.id, organizationId, input.nextRetryAt],
          )
          : await client.query<{
          id: number | string;
          qdrant_attempts: number | string;
        }>(
          `
            INSERT INTO ingest_jobs (
              memory_record_id,
              organization_id,
              status,
              qdrant_status,
              qdrant_attempts,
              qdrant_next_retry_at
            ) VALUES ($1, $2, 'pending', 'pending', 0, $3)
            RETURNING id, qdrant_attempts
          `,
          [input.record.id, organizationId, input.nextRetryAt],
        );
        const row = requireSingleRow(jobResult.rows[0], "ingest job");
        const job = {
          id: toPositiveSafeInteger(row.id, "ingest job id"),
          qdrantAttempts: toNonNegativeSafeInteger(
            row.qdrant_attempts,
            "ingest job qdrant_attempts",
          ),
        };
        await client.query("COMMIT");
        return {
          chunks,
          job,
        };
      } catch (error: unknown) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async listChunks(organizationId, scopes, options) {
      assertNonBlankText(organizationId, "organizationId");
      const scopedOrganizationId = organizationId.trim();
      const scopedRefs = normalizeScopeRefs(scopes, "scopes");
      const listOptions = resolveListChunksOptions(options);

      if (scopedRefs.length === 0) {
        return [];
      }

      // organizationId occupies $1; scope params start at $2.
      const params: unknown[] = [scopedOrganizationId];
      const scopeClauses = scopedRefs.map((scope) => {
        const scopeTypeIndex = params.push(scope.scopeType);
        const scopeIdIndex = params.push(scope.scopeId);
        return `(mr.scope_type = $${scopeTypeIndex} AND mr.scope_id = $${scopeIdIndex})`;
      });
      const cursorClause = listOptions.afterChunkId === undefined
        ? ""
        : `AND mc.id > $${params.push(listOptions.afterChunkId)}`;
      const limitClause = listOptions.limit === undefined
        ? ""
        : `LIMIT $${params.push(listOptions.limit)}`;
      const result = await pool.query<ReindexableMemoryChunkRow>(
        `
          SELECT
            mc.id,
            mc.memory_record_id,
            mc.chunk_index,
            mc.content,
            mc.start_offset,
            mc.end_offset,
            mc.embedding_version,
            mc.embedding_provider, mc.embedding_model, mc.embedding_dimensions,
            mr.organization_id,
            mr.scope_type,
            mr.scope_id,
            mr.project_key,
            mr.durability,
            mr.kind,
            mr.title,
            mr.summary,
            COALESCE(mt.tags, '{}') AS tags,
            mr.updated_at
          FROM memory_chunks mc
          JOIN memory_records mr ON mr.id = mc.memory_record_id
          LEFT JOIN LATERAL (
            SELECT array_agg(memory_tags.tag ORDER BY memory_tags.tag) AS tags
            FROM memory_tags
            WHERE memory_tags.memory_record_id = mr.id
              AND memory_tags.organization_id = mr.organization_id
          ) mt ON TRUE
          WHERE mr.organization_id = $1 AND (${scopeClauses.join(" OR ")})
          ${cursorClause}
          ORDER BY mc.id ASC
          ${limitClause}
        `,
        params,
      );

      return result.rows.map(mapReindexableMemoryChunkRow);
    },

    async getChunksByRecordId(recordId) {
      assertPositiveSafeInteger(recordId, "recordId");

      const result = await pool.query<ReindexableMemoryChunkRow>(
        `
          SELECT
            mc.id,
            mc.memory_record_id,
            mc.chunk_index,
            mc.content,
            mc.start_offset,
            mc.end_offset,
            mc.embedding_version,
            mc.embedding_provider, mc.embedding_model, mc.embedding_dimensions,
            mr.organization_id,
            mr.scope_type,
            mr.scope_id,
            mr.project_key,
            mr.durability,
            mr.kind,
            mr.title,
            mr.summary,
            COALESCE(mt.tags, '{}') AS tags,
            mr.updated_at
          FROM memory_chunks mc
          JOIN memory_records mr ON mr.id = mc.memory_record_id
          LEFT JOIN LATERAL (
            SELECT array_agg(memory_tags.tag ORDER BY memory_tags.tag) AS tags
            FROM memory_tags
            WHERE memory_tags.memory_record_id = mr.id
              AND memory_tags.organization_id = mr.organization_id
          ) mt ON TRUE
          WHERE mc.memory_record_id = $1
          ORDER BY mc.chunk_index ASC
        `,
        [recordId],
      );

      return result.rows.map(mapReindexableMemoryChunkRow);
    },

    async createContextPackRun(input) {
      assertContextPackRunInput(input);
      const organizationId = input.organizationId.trim();

      await pool.query(
        `
          INSERT INTO context_pack_runs (
            organization_id,
            project_key,
            task,
            selected_memory_ids,
            pack_markdown
          ) VALUES ($1, $2, $3, $4::jsonb, $5)
        `,
        [
          organizationId,
          input.projectKey,
          input.task,
          JSON.stringify(input.selectedMemoryIds),
          input.packMarkdown,
        ],
      );
    },
  };
}

async function insertPostgresChunks(
  queryable: PgQueryable,
  input: {
    record: SearchMemoryResult;
    chunks: TextChunk[];
    embedding: ChunkEmbeddingConfig;
  },
): Promise<StoredMemoryChunk[]> {
  assertQueryable(queryable, "memory chunk queryable");
  assertChunkWriteInput(input);
  const orgId = input.record.organizationId ?? "default";
  assertNonBlankText(orgId, "organizationId");
  const organizationId = orgId.trim();

  if (input.chunks.length === 0) {
    return [];
  }

  // Build a single multi-row INSERT. Each chunk contributes 10 parameters;
  // the 5 embedding config columns are repeated per row (simpler, no CTE).
  // Constant values shared by every row:
  const recordId = input.record.id;
  const { provider, model, dimensions, version } = input.embedding;

  const params: unknown[] = [];
  const valueClauses: string[] = [];

  for (const chunk of input.chunks) {
    const base = params.length; // 0-based index before pushing
    params.push(
      organizationId,
      recordId,
      chunk.chunkIndex,
      chunk.content,
      chunk.startOffset,
      chunk.endOffset,
      provider,
      model,
      dimensions,
      version,
    );
    valueClauses.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`,
    );
  }

  const result = await queryable.query<StoredMemoryChunkRow>(
    `
      INSERT INTO memory_chunks (
        organization_id,
        memory_record_id,
        chunk_index,
        content,
        start_offset,
        end_offset,
        embedding_provider,
        embedding_model,
        embedding_dimensions,
        embedding_version
      ) VALUES ${valueClauses.join(",")}
      RETURNING
        id,
        memory_record_id,
        chunk_index,
        content,
        start_offset,
        end_offset,
        embedding_version,
        embedding_provider,
        embedding_model,
        embedding_dimensions
    `,
    params,
  );

  // RETURNING row order is not guaranteed to match VALUES order across all
  // PG versions. Build a keyed map by chunk_index and reassemble in input
  // order to guarantee the returned array matches input.chunks order.
  const byChunkIndex = new Map<number, (typeof result.rows)[number]>();
  for (const row of result.rows) {
    byChunkIndex.set(
      toNonNegativeSafeInteger(row.chunk_index, "memory chunk chunk_index"),
      row,
    );
  }

  return input.chunks.map((chunk) => {
    const row = requireSingleRow(
      byChunkIndex.get(chunk.chunkIndex),
      "memory chunk",
    );
    return mapStoredMemoryChunkRow(row);
  });
}

function mapStoredMemoryChunkRow(row: StoredMemoryChunkRow): StoredMemoryChunk {
  const startOffset = toNonNegativeSafeInteger(
    row.start_offset,
    "memory chunk start_offset",
  );
  const endOffset = toNonNegativeSafeInteger(
    row.end_offset,
    "memory chunk end_offset",
  );
  if (endOffset < startOffset) {
    throw new Error(
      "memory chunk end_offset must be greater than or equal to start_offset",
    );
  }

  return {
    id: toPositiveSafeInteger(row.id, "memory chunk id"),
    memoryRecordId: toPositiveSafeInteger(
      row.memory_record_id,
      "memory chunk memory_record_id",
    ),
    chunkIndex: toNonNegativeSafeInteger(
      row.chunk_index,
      "memory chunk chunk_index",
    ),
    content: mapRequiredText(row.content, "memory chunk content"),
    startOffset,
    endOffset,
    embeddingVersion: mapRequiredText(
      row.embedding_version,
      "memory chunk embedding_version",
    ).trim(),
    ...(row.embedding_provider === undefined ? {} : { embeddingProvider: mapRequiredText(row.embedding_provider, "memory chunk embedding_provider") }),
    ...(row.embedding_model === undefined ? {} : { embeddingModel: mapRequiredText(row.embedding_model, "memory chunk embedding_model") }),
    ...(row.embedding_dimensions === undefined ? {} : { embeddingDimensions: toPositiveSafeInteger(row.embedding_dimensions, "memory chunk embedding_dimensions") }),
  };
}

function mapReindexableMemoryChunkRow(
  row: ReindexableMemoryChunkRow,
): ReindexableMemoryChunk {
  return {
    ...mapStoredMemoryChunkRow(row),
    organizationId: mapRequiredText(
      row.organization_id,
      "memory chunk organization_id",
    ).trim(),
    scopeType: mapScopeType(row.scope_type),
    scopeId: mapRequiredText(row.scope_id, "memory chunk scope_id").trim(),
    projectKey: mapNullableText(row.project_key, "memory chunk project_key"),
    durability: mapDurability(row.durability),
    kind: mapMemoryKind(row.kind),
    title: mapNullableText(row.title, "memory chunk title"),
    summary: mapNullableText(row.summary, "memory chunk summary"),
    tags: mapNonBlankStringArray(row.tags, "memory chunk tags"),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toNonNegativeSafeInteger(value: unknown, fieldName: string): number {
  const numberValue = toNumber(value);
  assertNonNegativeSafeInteger(numberValue, fieldName);
  return numberValue;
}

function toPositiveSafeInteger(value: unknown, fieldName: string): number {
  const numberValue = toNumber(value);
  assertPositiveSafeInteger(numberValue, fieldName);
  return numberValue;
}

function mapRequiredText(value: unknown, fieldName: string): string {
  assertNonBlankText(value, fieldName);
  return value;
}

function mapNullableText(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }
  throw new Error(`${fieldName} must be a string or null`);
}

function mapNonBlankStringArray(value: unknown, fieldName: string): string[] {
  assertStringArray(value, fieldName);
  return value.map((item) => item.trim());
}

function mapScopeType(value: unknown): SearchMemoryResult["scopeType"] {
  if (value === "user" || value === "project") {
    return value;
  }
  throw new Error("memory chunk scope_type must be one of: user, project");
}

function mapDurability(value: unknown): string {
  if (value === "ephemeral" || value === "durable" || value === "archived") {
    return value;
  }
  throw new Error(
    "memory chunk durability must be one of: ephemeral, durable, archived",
  );
}

function mapMemoryKind(value: unknown): string {
  if (value === "decision" || value === "fact" || value === "summary") {
    return value;
  }
  throw new Error("memory chunk kind must be one of: decision, summary, fact");
}

function assertMemoryChunkPool(value: unknown): asserts value is PgPool {
  const candidate = assertObject(value, "memory chunk pool");
  assertFunction(candidate.query, "memory chunk pool.query");
  assertFunction(candidate.connect, "memory chunk pool.connect");
}

function assertQueryable(
  value: unknown,
  fieldName: string,
): asserts value is PgQueryable {
  const candidate = assertObject(value, fieldName);
  assertFunction(candidate.query, `${fieldName}.query`);
}

function assertChunkWriteInput(value: unknown): asserts value is {
  record: SearchMemoryResult;
  chunks: TextChunk[];
  embedding: ChunkEmbeddingConfig;
} {
  const candidate = assertObject(value, "chunk write input");
  assertChunkRecord(candidate.record);
  assertTextChunks(candidate.chunks, "chunks");
  assertChunkEmbeddingConfig(candidate.embedding);
}

function assertReplaceChunksWithPendingIngestInput(
  value: unknown,
): asserts value is {
  record: SearchMemoryResult;
  chunks: TextChunk[];
  embedding: ChunkEmbeddingConfig;
  nextRetryAt: Date;
  jobId?: number;
} {
  const candidate = assertObject(value, "chunk replacement input");
  assertValidDate(candidate.nextRetryAt, "nextRetryAt");
  if (candidate.jobId !== undefined) {
    assertPositiveSafeInteger(candidate.jobId, "jobId");
  }
  assertChunkWriteInput(candidate);
}

function assertChunkRecord(value: unknown): asserts value is SearchMemoryResult {
  const candidate = assertObject(value, "chunk record");
  assertPositiveSafeInteger(candidate.id, "record.id");
  if (candidate.organizationId !== undefined) {
    assertNonBlankText(candidate.organizationId, "organizationId");
  }
}

function assertTextChunks(value: unknown, fieldName: string): asserts value is TextChunk[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  for (const [index, chunk] of value.entries()) {
    const candidate = assertObject(chunk, `${fieldName}[${index}]`);
    assertNonNegativeSafeInteger(
      candidate.chunkIndex,
      `${fieldName}[${index}].chunkIndex`,
    );
    assertNonBlankText(candidate.content, `${fieldName}[${index}].content`);
    assertNonNegativeSafeInteger(
      candidate.startOffset,
      `${fieldName}[${index}].startOffset`,
    );
    assertNonNegativeSafeInteger(
      candidate.endOffset,
      `${fieldName}[${index}].endOffset`,
    );
    if (
      typeof candidate.startOffset === "number"
      && typeof candidate.endOffset === "number"
      && candidate.endOffset < candidate.startOffset
    ) {
      throw new Error(
        `${fieldName}[${index}].endOffset must be greater than or equal to startOffset`,
      );
    }
  }
}

function assertChunkEmbeddingConfig(
  value: unknown,
): asserts value is ChunkEmbeddingConfig {
  const candidate = assertObject(value, "chunk embedding config");
  assertNonBlankText(candidate.provider, "embedding.provider");
  assertNonBlankText(candidate.model, "embedding.model");
  assertPositiveSafeInteger(candidate.dimensions, "embedding.dimensions");
  assertNonBlankText(candidate.version, "embedding.version");
  assertPositiveSafeInteger(candidate.targetTokens, "embedding.targetTokens");
  assertNonNegativeSafeInteger(
    candidate.overlapTokens,
    "embedding.overlapTokens",
  );
}

function assertPointIdMappings(
  value: unknown,
): asserts value is Array<{ chunkId: number; qdrantPointId: string }> {
  if (!Array.isArray(value)) {
    throw new Error("point ID mappings must be an array");
  }

  for (const [index, mapping] of value.entries()) {
    const candidate = assertObject(mapping, `point ID mappings[${index}]`);
    assertPositiveSafeInteger(
      candidate.chunkId,
      `point ID mappings[${index}].chunkId`,
    );
    assertNonBlankText(
      candidate.qdrantPointId,
      `point ID mappings[${index}].qdrantPointId`,
    );
  }
}


function resolveListChunksOptions(
  options: ListChunksOptions | undefined,
): ListChunksOptions {
  if (options === undefined) {
    return {};
  }

  const candidate = assertObject(options, "list chunks options");
  if (candidate.afterChunkId !== undefined) {
    assertPositiveSafeInteger(candidate.afterChunkId, "afterChunkId");
  }
  if (candidate.limit !== undefined) {
    assertPositiveSafeInteger(candidate.limit, "limit");
  }

  return {
    afterChunkId: candidate.afterChunkId as number | undefined,
    limit: candidate.limit as number | undefined,
  };
}

function assertContextPackRunInput(value: unknown): asserts value is {
  organizationId: string;
  projectKey: string;
  task: string;
  selectedMemoryIds: string[];
  packMarkdown: string;
} {
  const candidate = assertObject(value, "context pack run input");
  assertNonBlankText(candidate.organizationId, "organizationId");
  assertNonBlankText(candidate.projectKey, "projectKey");
  assertNonBlankText(candidate.task, "task");
  assertStringArray(candidate.selectedMemoryIds, "selectedMemoryIds");
  assertNonBlankText(candidate.packMarkdown, "packMarkdown");
}

function assertStringArray(
  value: unknown,
  fieldName: string,
): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  for (const [index, item] of value.entries()) {
    assertNonBlankText(item, `${fieldName}[${index}]`);
  }
}

function assertScopeType(value: unknown, fieldName: string): asserts value is ScopeRef["scopeType"] {
  if (value !== "project" && value !== "user") {
    throw new Error(`${fieldName} must be "project" or "user"`);
  }
}

function assertValidDate(value: unknown, fieldName: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date`);
  }
}

function assertPositiveSafeInteger(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
}

function assertObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertFunction(value: unknown, fieldName: string): void {
  if (typeof value !== "function") {
    throw new Error(`${fieldName} must be a function`);
  }
}
export { type ChunkEmbeddingConfig, type EmbeddingClient, type ListChunksOptions, type MemoryChunkRepository, type ReindexableMemoryChunk, type StoredMemoryChunk } from "../../application/ports/indexing.js";
