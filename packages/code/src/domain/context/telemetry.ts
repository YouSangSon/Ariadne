import { redactSecrets } from "../security/redaction.js";
import { isRecord } from "./evidence.js";

export type ToolTelemetryInput = {
  indexRunId?: number | null;
  budget?: string | null;
  query?: string | null;
  changedFiles?: string[];
  resourceCount?: number;
  omitted?: unknown;
};

export type ResourceTelemetryInput = {
  uri: string;
  resourceKind: string;
  resourceId?: string | null;
  indexRunId?: number | null;
  returnedBytes: number;
};

export function emptyContextTelemetry(): unknown {
  return {
    version: 0,
    summary: {
      toolRuns: 0,
      resourceAccesses: 0,
      returnedBytes: 0,
      resourcesAdvertised: 0
    },
    toolRuns: [],
    resourceAccesses: []
  };
}

export function searchContextTelemetry(value: unknown): { indexRunId: number | null; resourceCount: number } {
  return {
    indexRunId: indexRunIdOf(value),
    resourceCount: resourceCountOf(value)
  };
}

export function explainEntityTelemetry(value: unknown): { indexRunId: number | null; resourceCount: number } {
  return {
    indexRunId: indexRunIdOf(value),
    resourceCount: resourceCountOf(value)
  };
}

export function indexRunIdOf(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const indexRunId = value.indexRunId;
  return typeof indexRunId === 'number' && Number.isFinite(indexRunId) ? indexRunId : null;
}

export function resourceCountOf(value: unknown): number {
  if (!isRecord(value) || !isRecord(value.resources)) return 0;
  return Object.values(value.resources).reduce<number>((total, item) => {
    if (Array.isArray(item)) return total + item.length;
    return typeof item === 'string' && item.length > 0 ? total + 1 : total;
  }, 0);
}

export function omittedCountsOf(value: unknown): unknown {
  if (!isRecord(value)) return {};
  return isRecord(value.omittedCounts) ? value.omittedCounts : {};
}

export function sanitizeTelemetryText(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : redactSecrets(value);
}

export function sanitizeTelemetryPaths(paths: string[]): string[] {
  return paths.map((item) => redactSecrets(item));
}

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}