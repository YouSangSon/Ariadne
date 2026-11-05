


export type CompactionRunStatus = "pending" | "completed" | "failed";
export type ArchiveReason = "duplicate" | "decay";
export type QdrantStatus = "pending" | "deleted" | "failed";

export type CreateCompactionRunInput = {
  organizationId: string;
  actor: string;
  scopeType: string;
  scopeId: string;
  dryRun: boolean;
  planGeneratedAt: Date;
  idempotencyKey: string; // UUID, server-generated
};

export type CompactionRunRow = {
  id: number;
  organizationId: string;
  status: CompactionRunStatus;
  archivedCount: number;
  duplicateCount: number;
  decayCount: number;
  qdrantFailed: number;
};

export type ApplyCompactionRecordInput = {
  runId: number;
  organizationId: string;
  recordId: number;
  reason: ArchiveReason;
  decayScore?: number;
  keptRecordId?: number;
  planGeneratedAt: Date; // TOCTOU anchor — DELETE only when updated_at <= this
};

export type ApplyCompactionRecordResult = {
  archived: boolean;
  archiveId?: number;
  qdrantPointIds: string[];
};

export type PendingQdrantCleanup = {
  archiveId: number;
  organizationId: string;
  sourceRecordId?: number;
  qdrantPointIds: string[];
  attemptCount: number;
};

export type CompleteCompactionRunInput = {
  runId: number;
  status: CompactionRunStatus;
  archivedCount: number;
  duplicateCount: number;
  decayCount: number;
  qdrantFailed: number;
  errorMessage?: string;
};

export type MemoryArchiveRepository = {
  createCompactionRun(input: CreateCompactionRunInput): Promise<CompactionRunRow>;
  findRunByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<CompactionRunRow | null>;
  applyCompactionRecord(
    input: ApplyCompactionRecordInput,
  ): Promise<ApplyCompactionRecordResult>;
  markQdrantStatus(
    archiveId: number,
    status: QdrantStatus,
    errorMessage?: string,
  ): Promise<void>;
  completeCompactionRun(input: CompleteCompactionRunInput): Promise<void>;
  findPendingQdrantCleanup(limit: number): Promise<PendingQdrantCleanup[]>;
  claimPendingQdrantCleanup(input: {
    limit: number;
    now: Date;
  }): Promise<PendingQdrantCleanup[]>;
  acquireScopeLock(args: {
    organizationId: string;
    scopeType: string;
    scopeId: string;
  }): Promise<boolean>;
  // Counts dryRun=false runs for an org started within the given window.
  // Used by the apply-path rate limit to refuse a new apply when an org has
  // already run one recently.
  countRecentApplyRuns(
    organizationId: string,
    windowMs: number,
  ): Promise<number>;
  // Unarchive recovery flow.
  findArchiveByIds(
    archiveIds: number[],
    organizationId: string,
  ): Promise<ArchiveRow[]>;
  restoreToCanonical(
    archive: ArchiveRow,
    organizationId: string,
    beforeCommit?: (recordId: number) => Promise<void>,
  ): Promise<{ restoredRecordId: number }>;
  deleteRestoredCanonicalRecord(
    recordId: number,
    organizationId: string,
  ): Promise<void>;
  markUnarchived(archiveId: number): Promise<void>;
};

export type ArchiveRow = {
  id: number;
  organizationId: string;
  sourceRecordId: number;
  sourceId: number | null;
  scopeType: string;
  scopeId: string;
  projectKey: string | null;
  kind: string;
  title: string | null;
  content: string;
  summary: string | null;
  durability: string;
  importance: number;
  originalCreatedAt: string;
  originalUpdatedAt: string;
  unarchivedAt: string | null;
};
