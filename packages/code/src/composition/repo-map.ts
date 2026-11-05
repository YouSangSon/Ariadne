import { buildRepoMap as build } from "../application/context/repo-map.js";
import type { RepoMapOptions } from "../domain/model.js";
import { packageRootResolver } from "../infrastructure/filesystem/package-roots.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { queryCoChanges } from "./co-changes.js";
import { contextSearchPorts } from "./context-search.js";
import { analysisPorts } from "./impact.js";

export function buildRepoMap(options: RepoMapOptions) {
  return build(options, { normalizeRoot: normalizeRepoRoot, packageRoots: packageRootResolver, coChanges: queryCoChanges, analysis: analysisPorts, search: contextSearchPorts });
}
export { estimateRepoMapTokens } from '../domain/context/repo-map.js';
