

export type { AbandonBranchInput,AbandonBranchResult,GcBranchSummary,GcBranchesOptions,GcBranchesResult,RestoreBranchInput,RestoreBranchResult } from "./domain/local-memory/branches.js";
export { abandonBranch,gcBranches,restoreBranch } from "./infrastructure/sqlite/branch-gc.js";
