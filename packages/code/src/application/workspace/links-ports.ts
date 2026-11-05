import type { ListWorkspacesOptions, ListWorkspacesResult } from "../../domain/workspace/catalog.js";
import type { CrossRepoDiagnostic, CrossRepoLinkRecord } from "../../domain/workspace/links.js";

export interface WorkspaceLinksPorts {
  listWorkspaces(options: ListWorkspacesOptions): ListWorkspacesResult;
  loadLinks(root: string, name: string): { rowsSeen: number; records: CrossRepoLinkRecord[]; malformed: CrossRepoDiagnostic[] };
}
