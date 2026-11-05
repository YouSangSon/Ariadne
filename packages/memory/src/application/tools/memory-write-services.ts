import type { IngestJob } from "../../domain/model/memory.js";
import type { CanonicalServices, WithCanonicalServices } from "../contracts/tools.js";
import { createPendingIndexJob } from "../indexing/pending-index-job.js";
import type { CanonicalMemoryRepository } from "../ports/memory-repositories.js";

export function withMemoryRecordWrite<T>(
  withServices: WithCanonicalServices,
  organizationId: string,
  recordIds: readonly number[],
  work: (services: CanonicalServices) => Promise<T>,
): Promise<T> {
  return withServices((services) => services.writes
    ? services.writes.record(organizationId, recordIds, (scope) => work({ ...services, ...scope }))
    : work(services));
}

export async function updateWithIndexIntent(
  services: CanonicalServices,
  input: Parameters<CanonicalMemoryRepository["updateMemoryRecord"]>[0],
  refresh: boolean,
) {
  let job: IngestJob | undefined;
  const memory = services.writes && refresh
    ? await services.repository.updateMemoryRecord(input, async (record) => {
      job = await createPendingIndexJob(services.ingestJobs, record.id, input.organizationId);
    })
    : await services.repository.updateMemoryRecord(input);
  return { memory, job };
}
