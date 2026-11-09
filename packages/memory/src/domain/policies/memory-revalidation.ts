import { scanForSecrets, SecretDetectedError } from "./secret-scrub.js";

export type MemoryRevalidation = {
  schemaVersion: 1;
  recheck: { method: string; trigger: string; boundContentDigest: string };
  sourceObservations: { ref: string; digest: string }[];
  dependencies: { memoryId: number; contentDigest: string }[];
  derivatives: { kind: "summary" | "wiki" | "context"; owner: string; ref: string; digest: string }[];
};

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("revalidation must contain objects");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error("unknown revalidation field");
  return record;
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("invalid bounded revalidation text");
  const matches = scanForSecrets(value);
  if (matches.length) throw new SecretDetectedError(matches.map((match) => match.category));
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("invalid revalidation digest");
  return value;
}
function entries(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error("revalidation arrays must contain at most 64 entries");
  return value;
}
export function validateMemoryRevalidation(value: unknown): MemoryRevalidation {
  const record = object(value, ["schemaVersion", "recheck", "sourceObservations", "dependencies", "derivatives"]);
  if (record.schemaVersion !== 1) throw new Error("unsupported revalidation schemaVersion");
  const recheck = object(record.recheck, ["method", "trigger", "boundContentDigest"]);
  const result: MemoryRevalidation = {
    schemaVersion: 1,
    recheck: { method: text(recheck.method, 4096), trigger: text(recheck.trigger), boundContentDigest: digest(recheck.boundContentDigest) },
    sourceObservations: entries(record.sourceObservations).map((value) => {
      const row = object(value, ["ref", "digest"]);
      return { ref: text(row.ref), digest: digest(row.digest) };
    }),
    dependencies: entries(record.dependencies).map((value) => {
      const row = object(value, ["memoryId", "contentDigest"]);
      if (!Number.isSafeInteger(row.memoryId) || (row.memoryId as number) <= 0) throw new Error("invalid dependency memoryId");
      return { memoryId: row.memoryId as number, contentDigest: digest(row.contentDigest) };
    }),
    derivatives: entries(record.derivatives).map((value) => {
      const row = object(value, ["kind", "owner", "ref", "digest"]);
      if (row.kind !== "summary" && row.kind !== "wiki" && row.kind !== "context") throw new Error("invalid derivative kind");
      return { kind: row.kind, owner: text(row.owner), ref: text(row.ref), digest: digest(row.digest) };
    }),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32768) throw new Error("revalidation exceeds 32768 bytes");
  return result;
}
