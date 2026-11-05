import type { ListWorkspacesResult } from "../../domain/workspace/catalog.js";
import { workspaceContractsResourceUri, workspaceCrossRepoLinksResourceUri, workspaceResourceUri, workspaceResources } from "../../domain/workspace/resources.js";
import { errorMessage, typedMcpError } from "../context/errors.js";
import type { McpContext } from "../context/request.js";
import type { McpResourceListItem } from "../context/resource-model.js";
import { eventTopologyFromProvenance, parsedProvenance } from "../context/resource-projection.js";
import type { WorkspaceResourcePorts } from "./resource-ports.js";

export function selectMcpWorkspace(context: McpContext, workspaceName: string, ports: WorkspaceResourcePorts): ListWorkspacesResult['workspaces'][number] {
  const workspace = ports.listWorkspaces({ repoRoot: context.repoRoot, name: workspaceName }).workspaces[0];
  if (!workspace) throw typedMcpError(new Error(`impact workspace not found: ${workspaceName}`), 'resource_not_found');
  return workspace;
}

export function listMcpWorkspaces(context: McpContext, ports: WorkspaceResourcePorts): ListWorkspacesResult['workspaces'] {
  return ports.listWorkspaces({ repoRoot: context.repoRoot }).workspaces;
}

export function listWorkspaceResources(context: McpContext, ports: WorkspaceResourcePorts): McpResourceListItem[] {
  return listMcpWorkspaces(context, ports).map((workspace) => ({
    uri: workspaceResourceUri(workspace.name),
    name: `Workspace ${workspace.name}`,
    mimeType: 'application/json'
  }));
}

export function listWorkspaceContractResources(context: McpContext, ports: WorkspaceResourcePorts): McpResourceListItem[] {
  return listMcpWorkspaces(context, ports).map((workspace) => ({
    uri: workspaceContractsResourceUri(workspace.name),
    name: `Workspace ${workspace.name} contracts`,
    mimeType: 'application/json'
  }));
}

export function listWorkspaceCrossRepoLinkResources(context: McpContext, ports: WorkspaceResourcePorts): McpResourceListItem[] {
  return listMcpWorkspaces(context, ports).map((workspace) => ({
    uri: workspaceCrossRepoLinksResourceUri(workspace.name),
    name: `Workspace ${workspace.name} cross-repo links`,
    mimeType: 'application/json'
  }));
}

export function readWorkspaceResource(context: McpContext, workspaceName: string, ports: WorkspaceResourcePorts): unknown {
  const workspace = selectMcpWorkspace(context, workspaceName, ports);
  return {
    version: 0,
    workspace,
    resources: workspaceResources(workspace.name)
  };
}

export function readWorkspaceContractsResource(context: McpContext, workspaceName: string, ports: WorkspaceResourcePorts): unknown {
  const workspace = selectMcpWorkspace(context, workspaceName, ports);
  const warnings: string[] = [];
  const contracts = workspace.repos.flatMap((repo) => {
    try {
      const { rows, indexRunId } = ports.contracts(repo);

      return rows.map((row) => ({
        id: row.id,
        serviceName: row.service_name ?? repo.serviceName,
        repoPath: repo.localPath,
        path: row.path,
        kind: row.kind,
        ...(row.schema_version !== null ? { schemaVersion: row.schema_version } : {}),
        contentHash: row.content_hash,
        indexRunId,
        endpointCount: row.endpoint_count,
        contractDiffHint: {
          tool: 'parallax_contract_diff',
          workspaceName: workspace.name,
          contractPath: row.path,
          providerServiceName: row.service_name ?? repo.serviceName
        }
      }));
    } catch (error) {
      warnings.push(`workspace contract repo skipped: ${repo.localPath}: ${errorMessage(error)}`);
      return [];
    }
  });

  return {
    version: 0,
    workspace: workspace.name,
    contracts,
    warnings,
    resources: workspaceResources(workspace.name)
  };
}

export function readWorkspaceCrossRepoLinksResource(context: McpContext, workspaceName: string, ports: WorkspaceResourcePorts): unknown {
  const workspace = selectMcpWorkspace(context, workspaceName, ports);
  const limit = 500;
  const { rows } = ports.links(context.repoRoot, workspace.name, limit);
  return {
    version: 0,
    workspace: workspace.name,
    links: rows.slice(0, limit).map((row) => {
      const provenance = parsedProvenance(row.provenance);
      const eventTopology = eventTopologyFromProvenance(provenance);
      return {
        id: row.id,
        kind: row.kind,
        confidence: row.confidence,
        sourceRepoPath: row.source_repo_path,
        sourceService: row.source_service,
        targetRepoPath: row.target_repo_path,
        targetService: row.target_service,
        indexRunId: row.index_run_id,
        ...(eventTopology !== undefined ? { eventTopology } : {}),
        provenance
      };
    }),
    limits: {
      links: limit,
      truncated: rows.length > limit
    },
    resources: workspaceResources(workspace.name)
  };
}