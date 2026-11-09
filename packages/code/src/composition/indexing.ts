import { indexProjectInternal } from "../application/indexing/index-project.js";
import { AdapterRegistry } from "../domain/indexing/adapter-registry.js";
import type { IndexOptions, IndexResult } from "../domain/model.js";
import { scanFiles } from "../infrastructure/filesystem/index-scan.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { readCommitHistory } from "../infrastructure/git/co-change.js";
import { readGitSnapshot } from "../infrastructure/git/snapshot.js";
import { openIndexingSession } from "../infrastructure/sqlite/indexing.js";
import { createDefaultRegistry } from "./extractors.js";

export async function indexProject(options: IndexOptions): Promise<IndexResult> {
  return indexProjectInternal(options, createDefaultRegistry(), indexingPorts);
}

export async function indexProjectWithRegistryForTest(
  options: IndexOptions,
  registry: AdapterRegistry
): Promise<IndexResult> {
  return indexProjectInternal(options, registry, indexingPorts);
}
const indexingPorts = {
  normalizeRoot: normalizeRepoRoot,
  openSession: openIndexingSession,
  gitSnapshot: readGitSnapshot,
  commitHistory: readCommitHistory,
  scanFiles
};

export { scanFiles } from '../infrastructure/filesystem/index-scan.js';
export { createDefaultRegistry } from './extractors.js';
