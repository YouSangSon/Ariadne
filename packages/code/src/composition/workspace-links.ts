import * as useCases from "../application/workspace/links.js";
import { resolveCrossRepoContracts as resolveContracts } from "../application/workspace/resolve-contracts.js";
import type { CrossRepoConsumersOptions, CrossRepoLinkVerifyOptions, CrossRepoProvidersOptions } from "../domain/workspace/links.js";
import type { ResolveCrossRepoContractsOptions } from "../domain/workspace/resolution.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { readWorkspaceLinks } from "../infrastructure/sqlite/cross-repo-links.js";
import { openIndexedWorkspaceReaders, persistCrossRepoLinks } from "../infrastructure/sqlite/cross-repo-resolver.js";
import { listWorkspaces } from "./workspace.js";

const ports = { listWorkspaces, loadLinks: readWorkspaceLinks };
export const verifyCrossRepoLinks = (options: CrossRepoLinkVerifyOptions) => useCases.verifyCrossRepoLinks(options, ports);
export const consumersOf = (options: CrossRepoConsumersOptions) => useCases.consumersOf(options, ports);
export const providersFor = (options: CrossRepoProvidersOptions) => useCases.providersFor(options, ports);
export const resolveCrossRepoContracts = (options: ResolveCrossRepoContractsOptions) => resolveContracts(options, { normalizeRoot: normalizeRepoRoot, listWorkspaces, openRepos: openIndexedWorkspaceReaders, persistLinks: persistCrossRepoLinks });
export * from '../domain/workspace/links.js';
export * from '../domain/workspace/resolution.js';
