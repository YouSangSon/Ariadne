

export { recallOnRepo,reembedFacts,rememberOnRepo } from "./composition/local-memory.js";
export type { BranchInput,BranchResult,MergeBranchInput,MergeBranchResult,RecallInput,RecallResult,RecalledFact,ReembedOptions,ReembedResult,ReindexVecOptions,ReindexVecResult,RememberInput,RememberResult,RememberValue,TraceEdge,TraceInput,TraceResult } from "./domain/local-memory/model.js";
export { createBranch,factLifecycle,mergeBranches,recall,recallSemantic,reindexVec,reindexVecOnRepo,remember,trace,withAgentMemoryDb } from "./infrastructure/sqlite/local-memory.js";
