import { analyzeDiff as analyze } from "../application/impact/analyze.js";
import type { AnalyzeOptions } from "../domain/model.js";
import { currentFileHash, makeEvidence, writeImpactReport } from "../infrastructure/filesystem/impact-sources.js";
import { normalizeRepoRoot, resolveInsideRoot, toRelativePath } from "../infrastructure/filesystem/security.js";
import { openAnalysisSession } from "../infrastructure/sqlite/impact.js";

export function analyzeDiff(options: AnalyzeOptions) {
  return analyze(options, analysisPorts);
}

export const analysisPorts = {
  normalizeRoot: normalizeRepoRoot,
  changedPath: (root: string, file: string) => toRelativePath(root, resolveInsideRoot(root, file)),
  openSession: openAnalysisSession,
  currentFileHash,
  sourceEvidence: makeEvidence,
  writeReport: writeImpactReport
};
