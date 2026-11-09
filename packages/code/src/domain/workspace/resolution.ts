import { createHash } from "node:crypto";
import path from "node:path";
import { contentHash } from "../identity.js";
import type { Confidence } from "../model.js";
import type { WorkspaceSummary } from "./catalog.js";
import { firstMatchingAsyncApiEventEvidence } from "./matching/asyncapi.js";
import { firstMatchingGraphqlOperationLine } from "./matching/graphql.js";
import { firstMatchingHttpEvidence } from "./matching/http.js";
import { firstMatchingProtobufRpcLine } from "./matching/protobuf.js";
import { isDocumentationPath, isGeneratedProtobufFilePath, isSourceFilePath, isSourceOrConfigFilePath } from "./matching/shared.js";
import type { ConsumerEvidence, CrossRepoEventTopology } from "./matching/types.js";

export type ResolveCrossRepoContractsOptions = {
  repoRoot: string;
  workspaceName?: string;
  syncCatalog?: boolean;
  persist?: boolean;
};

export type CrossRepoContractLink = {
  kind: 'CONSUMES_HTTP_ENDPOINT';
  confidence: Confidence;
  consumerService: string;
  consumerRepoPath: string;
  consumerPath: string;
  providerService: string;
  providerRepoPath: string;
  providerContractPath: string;
  providerEndpointId: string;
  httpMethod: string;
  routePath: string;
  eventTopology?: CrossRepoEventTopology;
};

export type ResolveCrossRepoContractsResult = {
  workspace: WorkspaceSummary;
  links: CrossRepoContractLink[];
  warnings: string[];
};

export type ProviderEndpoint = {
  repoPath: string;
  serviceName: string;
  contractPath: string;
  endpointId: string;
  httpMethod: string;
  routePath: string;
};

export type ConsumerMatch = {
  repoPath: string;
  serviceName: string;
  filePath: string;
  snippet: string;
  eventTopology?: CrossRepoEventTopology;
};

export type PersistableLink = CrossRepoContractLink & {
  evidenceSnippet: string;
};

export type WorkspaceRow = {
  id: number;
  name: string;
};

export type EndpointRow = {
  contract_path: string;
  contract_kind: string | null;
  contract_language_id: string | null;
  endpoint_id: string;
  endpoint_display_name: string;
  content_hash: string;
};

export type FileRow = {
  path: string;
  content_hash: string;
};

export const RESOLVER_ID = 'cross-repo-contracts-v0';

export const LINK_KIND = 'CONSUMES_HTTP_ENDPOINT';

export function shouldScanConsumerFile(filePath: string, endpoint: ProviderEndpoint): boolean {
  if (endpoint.httpMethod === 'GRAPHQL') {
    if (isDocumentationPath(filePath)) return false;
    return /\.(?:graphql|gql|tsx?|jsx?)$/i.test(filePath);
  }
  if (endpoint.httpMethod === 'RPC') {
    if (isDocumentationPath(filePath)) return false;
    if (isGeneratedProtobufFilePath(filePath)) return false;
    return isSourceFilePath(filePath);
  }
  if (isAsyncApiEndpointMethod(endpoint.httpMethod)) {
    if (isDocumentationPath(filePath)) return false;
    return isSourceOrConfigFilePath(filePath);
  }
  return true;
}

export function packagePrefix(indexedRepoPath: string, memberPath: string): string {
  const relative = path.relative(indexedRepoPath, memberPath);
  return relative === '' ? '' : relative.split(path.sep).join('/');
}

export function memberRelativePath(repo: IndexedRepoInfo, indexedPath: string): string | undefined {
  if (repo.packagePrefix === '') return indexedPath;
  const prefix = `${repo.packagePrefix}/`;
  return indexedPath.startsWith(prefix) ? indexedPath.slice(prefix.length) : undefined;
}

export function firstMatchingEvidence(content: string, filePath: string, endpoint: ProviderEndpoint): ConsumerEvidence | undefined {
  if (endpoint.httpMethod === 'GRAPHQL') {
    const snippet = firstMatchingGraphqlOperationLine(content, filePath, endpoint.routePath);
    return snippet === undefined ? undefined : { snippet };
  }
  if (endpoint.httpMethod === 'RPC') {
    const snippet = firstMatchingProtobufRpcLine(content, filePath, endpoint.routePath);
    return snippet === undefined ? undefined : { snippet };
  }
  if (isAsyncApiEndpointMethod(endpoint.httpMethod)) {
    return firstMatchingAsyncApiEventEvidence(content, filePath, endpoint.httpMethod, endpoint.routePath);
  }
  return firstMatchingHttpEvidence(content, filePath, endpoint.httpMethod, endpoint.routePath);
}

export function isAsyncApiEndpointMethod(method: string): boolean {
  return /^(?:SEND|RECEIVE|PUBLISH|SUBSCRIBE)$/i.test(method);
}

export function parseContractEndpointDisplay(displayName: string, contractKind: string | undefined): { method: string; path: string } | undefined {
  return parseHttpEndpointDisplay(displayName) ?? parseTypedContractEndpointDisplay(displayName, contractKind);
}

export function parseHttpEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(\S+)$/i.exec(displayName.trim());
  if (!match) return undefined;
  return { method: match[1]!.toUpperCase(), path: match[2]! };
}

export function parseGraphqlEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^(?:GRAPHQL\s+)?((?:Query|Mutation|Subscription)\.[_A-Za-z][_0-9A-Za-z]*)$/.exec(displayName.trim());
  if (!match) return undefined;
  return { method: 'GRAPHQL', path: match[1]! };
}

export function providerContractKind(row: EndpointRow): string | undefined {
  const kind = row.contract_kind ?? row.contract_language_id;
  if (kind && kind.length > 0) return kind.toLowerCase();
  if (/\.proto$/i.test(row.contract_path)) return 'protobuf';
  if (/\.(?:graphql|gql)$/i.test(row.contract_path)) return 'graphql';
  if (isAsyncApiContractPath(row.contract_path)) return 'asyncapi';
  return undefined;
}

export function parseTypedContractEndpointDisplay(displayName: string, contractKind: string | undefined): { method: string; path: string } | undefined {
  if (contractKind === 'protobuf') return parseProtobufEndpointDisplay(displayName);
  if (contractKind === 'graphql') return parseGraphqlEndpointDisplay(displayName);
  if (contractKind === 'asyncapi') return parseAsyncApiEndpointDisplay(displayName);
  return undefined;
}

export function parseProtobufEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(displayName.trim());
  if (!match) return undefined;
  return { method: 'RPC', path: `${match[1]!}/${match[2]!}` };
}

export function parseAsyncApiEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^([A-Z][A-Z0-9_-]*)\s+(.+)$/.exec(displayName.trim());
  if (!match) return undefined;
  return { method: match[1]!, path: match[2]! };
}

export function isAsyncApiContractPath(filePath: string): boolean {
  return /(?:^|\/|\\)[^/\\]*asyncapi[^/\\]*\.(?:ya?ml|json)$/i.test(filePath);
}

export function linkProvenance(link: PersistableLink): string {
  return stableJson({
    schemaVersion: 1,
    resolver: RESOLVER_ID,
    consumer: {
      serviceName: link.consumerService,
      repoPath: link.consumerRepoPath,
      path: link.consumerPath
    },
    provider: {
      serviceName: link.providerService,
      repoPath: link.providerRepoPath,
      contractPath: link.providerContractPath,
      endpointId: link.providerEndpointId
    },
    http: {
      method: link.httpMethod,
      path: link.routePath
    },
    ...(link.eventTopology !== undefined ? { eventTopology: link.eventTopology } : {}),
    evidence: {
      filePath: link.consumerPath,
      snippet: link.evidenceSnippet
    }
  });
}

export function linkId(workspaceId: number, link: CrossRepoContractLink): string {
  return contentHash(
    RESOLVER_ID,
    String(workspaceId),
    link.consumerRepoPath,
    link.consumerPath,
    link.providerRepoPath,
    link.providerEndpointId,
    link.httpMethod,
    link.routePath
  ).slice(0, 24);
}

export function dedupeLinks(links: PersistableLink[]): PersistableLink[] {
  const byId = new Map<string, PersistableLink>();
  for (const link of links) {
    const key = [
      link.consumerRepoPath,
      link.consumerPath,
      link.providerRepoPath,
      link.providerEndpointId,
      link.httpMethod,
      link.routePath
    ].join('\0');
    if (!byId.has(key)) byId.set(key, link);
  }
  return [...byId.values()];
}

export function compareLinks(left: CrossRepoContractLink, right: CrossRepoContractLink): number {
  return (
    left.consumerService.localeCompare(right.consumerService) ||
    left.consumerPath.localeCompare(right.consumerPath) ||
    left.providerService.localeCompare(right.providerService) ||
    left.providerContractPath.localeCompare(right.providerContractPath) ||
    left.httpMethod.localeCompare(right.httpMethod) ||
    left.routePath.localeCompare(right.routePath)
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function warnOnce(warnings: string[], warnedFiles: Set<string>, key: string, warning: string): void {
  if (warnedFiles.has(key)) return;
  warnedFiles.add(key);
  warnings.push(warning);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
export type IndexedRepoInfo = {
  repoPath: string;
  indexedRepoPath: string;
  packagePrefix: string;
  serviceName: string;
  repoId: number;
  indexRunId: number;
};

export type ResolvedConsumerFile = { filePath: string; content: string };

export function matchConsumerFiles(repo: IndexedRepoInfo, endpoint: ProviderEndpoint, files: ResolvedConsumerFile[]): ConsumerMatch[] {
  const matches: ConsumerMatch[] = [];
  for (const { filePath, content } of files) {
    const evidence = firstMatchingEvidence(content, filePath, endpoint);
    if (!evidence) continue;
    matches.push({
      repoPath: repo.repoPath,
      serviceName: repo.serviceName,
      filePath,
      snippet: evidence.snippet,
      ...(evidence.eventTopology !== undefined ? { eventTopology: evidence.eventTopology } : {})
    });
  }
  return matches;
}
