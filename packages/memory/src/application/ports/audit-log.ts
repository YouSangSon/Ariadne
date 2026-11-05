


export type AuditOutcome = "ok" | "error";

export type AuditLogEntry = {
  organizationId: string;
  actor: string;
  tool: string;
  projectKey?: string | null;
  outcome: AuditOutcome;
  errorMessage?: string | null;
  durationMs: number;
  requestId?: string | null;
};

export type StoredAuditLogEntry = AuditLogEntry & {
  id: number;
  createdAt: string;
};

export type AuditLogRepository = {
  record(entry: AuditLogEntry): Promise<void>;
  listByOrganization(
    organizationId: string,
    options?: { limit?: number },
  ): Promise<StoredAuditLogEntry[]>;
};
