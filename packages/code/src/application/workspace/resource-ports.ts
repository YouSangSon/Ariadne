import type { ListWorkspacesOptions, ListWorkspacesResult, WorkspaceRepoSummary } from "../../domain/workspace/catalog.js";
import type { WorkspaceContractRow, WorkspaceCrossRepoLinkRow } from "../context/resource-model.js";

export interface WorkspaceResourcePorts {
  listWorkspaces(options: ListWorkspacesOptions): ListWorkspacesResult;
  contracts(repo: WorkspaceRepoSummary): { indexRunId: number; rows: WorkspaceContractRow[] };
  links(root: string, name: string, limit: number): { rows: WorkspaceCrossRepoLinkRow[] };
}
