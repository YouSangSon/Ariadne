import { analyzeContractDiff as analyze, selectWorkspace } from "../application/contracts/analyze-diff.js";
import type { AnalyzeContractDiffOptions } from "../domain/contracts/contract-diff.js";
import { readCurrentContract } from "../infrastructure/filesystem/contract-sources.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { openContractProvider, projectContractImpacts } from "../infrastructure/sqlite/contract-diff.js";
import { listWorkspaces } from "./workspace.js";

export function analyzeContractDiff(options: AnalyzeContractDiffOptions) {
  return analyze(options, { normalizeRoot: normalizeRepoRoot, workspace: (root, name) => selectWorkspace(root, name, listWorkspaces), openProvider: openContractProvider, currentContract: readCurrentContract, projectImpacts: projectContractImpacts });
}
export * from '../domain/contracts/contract-diff.js';
export type { ContractDiffChange,ContractDiffChangeKind,ContractDiffClassification } from '../domain/contracts/diff/types.js';
