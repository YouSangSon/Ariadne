import { createHash } from "node:crypto";
import type { SearchMemoryResult } from "../../domain/model/memory.js";

export class MemoryRecordConflictError extends Error {
 constructor() { super("memory record digest conflict; read the record again"); this.name = "MemoryRecordConflictError"; }
}

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function memoryContentDigest(record: SearchMemoryResult): string {
  return hash(["memory-content-v1", record.id, record.organizationId ?? "default", record.scopeType, record.scopeId,
    record.projectKey ?? null, record.sourceId, record.memoryType, record.title ?? null, record.content, record.summary ?? null]);
}
export function memoryRecordDigest(record: SearchMemoryResult): string {
  return hash(["memory-record-v1", memoryContentDigest(record), record.durability ?? "ephemeral", record.importance ?? 0,
    [...(record.tags ?? [])].sort(), record.createdAt, record.updatedAt, record.revalidation ?? null]);
}
export function describeMemoryRevalidation(record: SearchMemoryResult) {
  return { bindingMatchesRecord: record.revalidation ? record.revalidation.recheck.boundContentDigest === memoryContentDigest(record) : null,
    sourceCurrentness: "unknown" as const, basis: "reported" as const };
}
export function inspectMemoryImpact(input: {
  records: SearchMemoryResult[]; changedMemoryIds: number[]; changedSourceRefs: string[]; truncated: boolean;
}) {
  const changed = new Set(input.changedMemoryIds);
  const affected = new Set<number>();
  const sourceRefs = new Set(input.changedSourceRefs);
  const available = new Set(input.records.map((record) => record.id));
  const unresolved = new Set(input.changedMemoryIds.filter((id) => !available.has(id)));
  const registeredSources = new Set(input.records.flatMap((record) => record.revalidation?.sourceObservations.map((source) => source.ref) ?? []));
  const unresolvedSources = input.changedSourceRefs.filter((ref) => !registeredSources.has(ref)).length;
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const record of input.records) {
      const metadata = record.revalidation;
      if (!metadata) continue;
      for (const dependency of metadata.dependencies) if (!available.has(dependency.memoryId)) unresolved.add(dependency.memoryId);
      if (changed.has(record.id) || affected.has(record.id)) continue;
      if (metadata.dependencies.some((dependency) => changed.has(dependency.memoryId) || affected.has(dependency.memoryId)) ||
          metadata.sourceObservations.some((source) => sourceRefs.has(source.ref))) {
        affected.add(record.id);
        advanced = true;
      }
    }
  }
  const derivatives = input.records.filter((record) => changed.has(record.id) || affected.has(record.id)).flatMap((record) =>
    (record.revalidation?.derivatives ?? []).map((derivative) => ({ memoryId: record.id, ...derivative })));
  const truncated = input.truncated || derivatives.length > 1000;
  return { coverage: "known_only" as const, dependenciesComplete: false as const, sourceCurrentness: "unknown" as const,
    basis: "reported" as const, registered_scan_complete: !truncated, truncated,
    unresolved_dependencies: unresolved.size + unresolvedSources, broader_review_required: true as const,
    affectedMemoryIds: [...affected].sort((a,b) => a-b),
    registeredDerivatives: derivatives.slice(0, 1000),
  };
}
