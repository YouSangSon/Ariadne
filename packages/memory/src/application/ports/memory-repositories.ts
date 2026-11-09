import type { MemoryRevalidation } from "../../domain/policies/memory-revalidation.js";
import type { AddMemoryInput, CloseGoalRunInput, Durability, GoalRun, GoalRunIteration, GoalRunWithIterations, IngestJob, ListGoalRunsInput, ListMemoryOptions, MemoryGraphView, MemoryType, RecordIterationInput, ScopeRef, SearchMemoryInput, SearchMemoryResult, StartGoalRunInput } from "../../domain/model/memory.js";
import type { EntityKind } from "../../domain/policies/entity-extraction.js";


export type MemoryRepository = {
  addMemory(input: AddMemoryInput): SearchMemoryResult;
  searchMemory(input: SearchMemoryInput): SearchMemoryResult[];
  listMemory(scope: ScopeRef, options?: ListMemoryOptions): SearchMemoryResult[];
  getMemoryRecordsByIds(
    ids: number[],
    organizationId?: string,
    allowLegacyAnonymous?: boolean,
  ): SearchMemoryResult[];
};

export type CanonicalMemoryRepository = {
  addMemory(
    input: AddMemoryInput,
    beforeCommit?: (record: SearchMemoryResult) => Promise<void>,
  ): Promise<SearchMemoryResult>;
  searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult[]>;
  listMemory(
    scope: ScopeRef,
    options?: ListMemoryOptions,
  ): Promise<SearchMemoryResult[]>;
  // organizationId scopes the WHERE clause. When organizationId is undefined
  // and allowLegacyAnonymous is not set, throws — silent cross-org reads are
  // too easy a footgun once a second tenant is added. Pass
  // allowLegacyAnonymous: true (wired from LEGACY_ANONYMOUS_SEARCH=true) to
  // restore the historical org-blind behavior.
  getMemoryRecordsByIds(
    ids: number[],
    organizationId?: string,
    allowLegacyAnonymous?: boolean,
  ): Promise<SearchMemoryResult[]>;
  listMemoryRecordIdsForIndexing?(
    organizationId: string,
    scopes: ScopeRef[],
    options?: { afterId?: number; throughId?: number; limit?: number },
  ): Promise<{ ids: number[]; throughId: number }>;
  listMemoryForGovernance(
    scope: ScopeRef,
    options: {
      organizationId: string;
      includeArchived?: boolean;
      tag?: string;
      limit?: number;
    },
  ): Promise<SearchMemoryResult[]>;
  inspectMemoryGraph(
    scope: ScopeRef,
    options: {
      organizationId: string;
      kind?: EntityKind;
      query?: string;
      includeArchived?: boolean;
      limit?: number;
      relationshipLimit?: number;
    },
  ): Promise<MemoryGraphView>;
  listMemoryRevalidationSnapshot?(scope: ScopeRef, options: { organizationId: string; limit: number }): Promise<{ records: SearchMemoryResult[]; truncated: boolean }>;
  updateMemoryRecord(
    input: {
      id: number;
      organizationId: string;
      revalidation?: MemoryRevalidation | null;
      expectedRecordDigest?: string;
      kind?: MemoryType;
      title?: string | null;
      content?: string;
      summary?: string | null;
      importance?: number;
      durability?: Durability;
      tags?: string[];
    },
    beforeCommit?: (record: SearchMemoryResult) => Promise<void>,
  ): Promise<SearchMemoryResult | null>;
  archiveMemoryRecord(
    input: {
      id: number;
      organizationId: string;
    },
    beforeCommit?: (recordId: number) => Promise<void>,
  ): Promise<{ archived: boolean; qdrantPointIds: string[] }>;
  getMemoryRecordById(
    id: number,
    organizationId: string,
  ): Promise<SearchMemoryResult | null>;
  // Hard-deletes a memory_records row by id scoped to the given organization.
  // The organization_id guard prevents cross-tenant deletion in the event of
  // id collision. Schema-level ON DELETE CASCADE (memory_chunks, ingest_jobs,
  // relationships) handles dependents atomically in the same statement. Used
  // by writeCanonicalMemory's rollback path when post-INSERT side effects
  // (embed / Qdrant upsert) fail — without this, failed writes leave
  // permanently dead PG state behind.
  deleteMemoryRecord(id: number, organizationId: string): Promise<void>;
};

export type IngestJobRepository = {
  create(input: { memoryRecordId: number; organizationId: string }): Promise<IngestJob>;
  getById?(jobId: number, organizationId: string): Promise<IngestJob | null>;
  markCompleted(jobId: number): Promise<IngestJob>;
  markFailed(jobId: number, error: unknown): Promise<IngestJob>;
  markQdrantCompleted(jobId: number): Promise<IngestJob>;
  markQdrantPending(input: {
    jobId: number;
    attempts: number;
    nextRetryAt: Date;
    error?: unknown;
  }): Promise<IngestJob>;
  markQdrantFailed(input: {
    jobId: number;
    attempts: number;
    error: unknown;
  }): Promise<IngestJob>;
  listPendingForRetry(input: { limit: number; now: Date }): Promise<IngestJob[]>;
  // Atomically claim rows due for retry by pushing qdrant_next_retry_at into a
  // visibility window in the same UPDATE that holds the FOR UPDATE SKIP LOCKED,
  // preventing concurrent sweeper replicas from re-claiming the same row while
  // still allowing crash recovery when the window expires.
  claimPendingForRetry(input: {
    limit: number;
    now: Date;
  }): Promise<IngestJob[]>;
};

export type GoalRunRepository = {
  start(input: StartGoalRunInput): Promise<GoalRun>;
  recordIteration(input: RecordIterationInput): Promise<GoalRunIteration>;
  get(input: {
    organizationId: string;
    goalRunId: number;
  }): Promise<GoalRunWithIterations | null>;
  list(input: ListGoalRunsInput): Promise<GoalRun[]>;
  complete(input: CloseGoalRunInput): Promise<GoalRun>;
  abandon(input: CloseGoalRunInput): Promise<GoalRun>;
};
