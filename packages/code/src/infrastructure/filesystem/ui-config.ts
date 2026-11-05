import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { configuredReportDeltaPolicy, defaultReportDeltaPolicy } from "../../application/context/report-delta.js";
import type { UiReportDeltaPolicy } from "../../application/context/ui-model.js";
import { impactDir } from "../sqlite/store.js";

export function readReportDeltaPolicy(repoRoot: string): UiReportDeltaPolicy {
  const fallback = defaultReportDeltaPolicy();
  const configPath = path.join(impactDir(repoRoot), 'config.json');
  if (!existsSync(configPath)) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  } catch {
    return fallback;
  }
  return configuredReportDeltaPolicy(parsed);
}