


export type DuplicateGroupView = {
  keepId: string;
  archiveIds: string[];
};

export type DecayCandidateView = {
  id: string;
  score: number;
};

export type CompactionApplyStats = {
  archived: number;
  skipped: number;
  qdrantPointsDeleted: number;
  qdrantPointsPending: number;
  durationMs: number;
};

export type CompactMemoryToolResult = {
  ok: true;
  projectKey: string;
  dryRun: boolean;
  archivedIds: string[];
  mergedIds: string[];
  promotionCandidates: string[];
  duplicateGroups: DuplicateGroupView[];
  decayCandidates: DecayCandidateView[];
  summary: string;
  // Populated when dryRun=false. compactionRunId is the server-generated UUID
  // idempotency key; applyStats summarizes the destructive run.
  compactionRunId?: string;
  applyStats?: CompactionApplyStats;
};
