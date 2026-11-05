import type { AbandonBranchInput, GcBranchesOptions, RestoreBranchInput } from "../domain/local-memory/branches.js";
import type { BranchInput, MergeBranchInput, TraceInput } from "../domain/local-memory/model.js";
import { abandonBranch, gcBranches, restoreBranch } from "../infrastructure/sqlite/branch-gc.js";
import { withReadOnlyDb } from "../infrastructure/sqlite/context-resources.js";
import { withWritableDb } from "../infrastructure/sqlite/context-telemetry.js";
import { createBranch, mergeBranches, trace } from "../infrastructure/sqlite/local-memory.js";

export const createBranchOnRepo = (root: string, input: BranchInput) => withWritableDb({ repoRoot: root }, (db) => createBranch(db, input));
export const mergeBranchesOnRepo = (root: string, input: MergeBranchInput) => withWritableDb({ repoRoot: root }, (db) => mergeBranches(db, input));
export const abandonBranchOnRepo = (root: string, input: AbandonBranchInput) => withWritableDb({ repoRoot: root }, (db) => abandonBranch(db, input));
export const gcBranchesOnRepo = (root: string, input: GcBranchesOptions) => withWritableDb({ repoRoot: root }, (db) => gcBranches(db, input));
export const restoreBranchOnRepo = (root: string, input: RestoreBranchInput) => withWritableDb({ repoRoot: root }, (db) => restoreBranch(db, input));
export const traceOnRepo = (root: string, input: TraceInput) => withReadOnlyDb({ repoRoot: root }, (db) => trace(db, input));
