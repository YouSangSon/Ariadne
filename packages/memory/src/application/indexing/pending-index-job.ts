import type { IngestJob } from "../../domain/model/memory.js";
import { nextRetryDelayMs } from "../../domain/policies/retry-backoff.js";
import type { IngestJobRepository } from "../ports/memory-repositories.js";


export async function createPendingIndexJob(
  jobs: IngestJobRepository,
  memoryRecordId: number,
  organizationId: string,
): Promise<IngestJob> {
  const job = await jobs.create({ memoryRecordId, organizationId });
  return jobs.markQdrantPending({
    jobId: job.id,
    attempts: job.qdrantAttempts,
    nextRetryAt: new Date(Date.now() + nextRetryDelayMs(job.qdrantAttempts)),
  });
}
