

export type { CrossRepoImpactCandidate,CrossRepoImpactLoadResult } from "./domain/workspace/cross-repo-impact.js";
export { loadCrossRepoImpactsForChangedContract } from "./infrastructure/sqlite/cross-repo-impact.js";
export type { CrossRepoImpactLoadOptions } from "./infrastructure/sqlite/cross-repo-impact.js";
