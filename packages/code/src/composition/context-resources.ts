import { explainEntity as explain } from "../application/context/explain-entity.js";
import type { McpContext } from "../application/context/request.js";
import type { EntityExplainOptions } from "../application/context/resource-model.js";
import * as workspace from "../application/workspace/resources.js";
import { openEntityExplanationSession } from "../infrastructure/sqlite/resource-readers.js";
import { readWorkspaceResourceContracts, readWorkspaceResourceLinks } from "../infrastructure/sqlite/workspace-resources.js";
import { listWorkspaces } from "./workspace.js";

const ports = { listWorkspaces, contracts: readWorkspaceResourceContracts, links: readWorkspaceResourceLinks };
export const explainEntity = (context: McpContext, options: EntityExplainOptions) => explain(context, options, openEntityExplanationSession);
export const listWorkspaceResources = (context: McpContext) => workspace.listWorkspaceResources(context, ports);
export const listWorkspaceContractResources = (context: McpContext) => workspace.listWorkspaceContractResources(context, ports);
export const listWorkspaceCrossRepoLinkResources = (context: McpContext) => workspace.listWorkspaceCrossRepoLinkResources(context, ports);
export const readWorkspaceResource = (context: McpContext, name: string) => workspace.readWorkspaceResource(context, name, ports);
export const readWorkspaceContractsResource = (context: McpContext, name: string) => workspace.readWorkspaceContractsResource(context, name, ports);
export const readWorkspaceCrossRepoLinksResource = (context: McpContext, name: string) => workspace.readWorkspaceCrossRepoLinksResource(context, name, ports);
export * from '../infrastructure/sqlite/resource-readers.js';
