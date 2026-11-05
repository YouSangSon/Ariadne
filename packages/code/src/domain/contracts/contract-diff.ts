import { createHash } from "node:crypto";
import path from "node:path";
import { contentHash } from "../identity.js";
import { isJsonSchemaContractPath } from "../indexing/entity-classification.js";
import type { WorkspaceSummary } from "../workspace/catalog.js";
import { classifyAsyncApiCompatibilityChanges, parseAsyncApiCompatibility } from "./diff/asyncapi.js";
import { classifyAvroCompatibilityChanges, parseAvroCompatibility } from "./diff/avro.js";
import { classifyGraphqlCompatibilityChanges, parseGraphqlCompatibility } from "./diff/graphql.js";
import { classifyJsonSchemaCompatibilityChanges, parseJsonSchemaCompatibility } from "./diff/json_schema.js";
import { classifyOpenApiCompatibilityChanges, parseOpenApiCompatibility } from "./diff/openapi.js";
import { classifyProtobufCompatibilityChanges, parseProtobufCompatibility } from "./diff/protobuf.js";
import { endpointKey, parseJsonObject } from "./diff/shared.js";
import type { ContractDiffChange, ContractDiffChangeKind, ContractDiffClassification, ContractEndpoint, CurrentContractParse } from "./diff/types.js";

export type AnalyzeContractDiffOptions = {
  repoRoot: string;
  workspaceName?: string;
  providerServiceName?: string;
  providerRepoPath?: string;
  contractPath: string;
  persist?: boolean;
};

export type ContractDiffProvider = {
  serviceName: string;
  repoPath: string;
};

export type ContractDiffContract = {
  path: string;
  id: string;
  kind: string;
  schemaVersion?: string;
  previousContentHash: string;
  currentContentHash?: string;
  indexRunId: number;
};

export type ImpactedContractConsumer = {
  consumerService: string;
  consumerRepoPath: string;
  consumerPath: string;
  providerService: string;
  providerRepoPath: string;
  providerContractPath: string;
  httpMethod: string;
  routePath: string;
  evidenceSnippet: string;
  eventTopology?: EventTopologyProvenance;
};

export type EventTopologyProvenance = {
  providerAction: string;
  counterpartyRole: 'consumer' | 'producer' | 'unknown';
  pattern: string;
};

export type EventTopologySummary = EventTopologyProvenance & {
  count: number;
};

export type AnalyzeContractDiffResult = {
  workspace: WorkspaceSummary;
  provider: ContractDiffProvider;
  contract: ContractDiffContract;
  summary: {
    classification: ContractDiffClassification;
    breakingChangeCount: number;
    nonBreakingChangeCount: number;
    unknownChangeCount: number;
    impactedConsumerCount: number;
    eventTopologyCount?: number;
    eventTopologyBreakdown?: EventTopologySummary[];
  };
  changes: ContractDiffChange[];
  impactedConsumers: ImpactedContractConsumer[];
  warnings: string[];
};

export type WorkspaceRow = {
  id: number;
  name: string;
};

export type ContractBaselineRow = {
  id: string;
  kind: string;
  service_name: string | null;
  path: string;
  schema_version: string | null;
  content_hash: string;
  compatibility_json: string;
};

export type EndpointRow = {
  endpoint_id: string;
  endpoint_display_name: string;
};

export type ConsumesLinkRow = {
  provenance: string;
};

export type PersistableBreakLink = {
  consumer: ImpactedContractConsumer;
  change: ContractDiffChange;
};

export const ANALYZER_ID = 'contract-diff-v0';

export const CONSUMES_LINK_KIND = 'CONSUMES_HTTP_ENDPOINT';

export const BREAKS_LINK_KIND = 'BREAKS_COMPATIBILITY_WITH';

export function classifyChanges(
  provider: ContractProviderBaseline,
  previousEndpoints: ContractEndpoint[],
  current: CurrentContractParse & { contentHash?: string },
  contractPath: string,
  warnings: string[]
): ContractDiffChange[] {
  if (!current.ok) {
    return [{
      kind: current.warning === 'current contract file could not be read'
        ? 'unreadable_current_contract'
        : 'unparsed_current_contract',
      classification: 'unknown',
      reason: current.warning ?? 'current contract could not be parsed'
    }];
  }

  const previousByKey = endpointsByKey(previousEndpoints);
  const currentByKey = endpointsByKey(
    current.endpoints.map((endpoint) => ({
      ...endpoint,
      endpointId: endpoint.endpointId ?? currentEndpointId(contractPath, endpoint)
    }))
  );
  const changes: ContractDiffChange[] = [];

  for (const [key, endpoint] of currentByKey) {
    if (previousByKey.has(key)) continue;
    changes.push({
      kind: 'added_endpoint',
      classification: 'non-breaking',
      reason: 'endpoint added to current contract',
      httpMethod: endpoint.httpMethod,
      routePath: endpoint.routePath,
      ...(endpoint.endpointId !== undefined ? { currentEndpointId: endpoint.endpointId } : {})
    });
  }

  for (const [key, endpoint] of previousByKey) {
    if (currentByKey.has(key)) continue;
    changes.push({
      kind: 'removed_endpoint',
      classification: 'breaking',
      reason: 'endpoint removed from current contract',
      httpMethod: endpoint.httpMethod,
      routePath: endpoint.routePath,
      ...(endpoint.endpointId !== undefined ? { previousEndpointId: endpoint.endpointId } : {})
    });
  }

  if (provider.contract.kind === 'protobuf') {
    const previousCompatibility = parseProtobufCompatibility(provider.contract.compatibility_json, warnings);
    if (previousCompatibility !== undefined && current.protobufCompatibility !== undefined) {
      changes.push(...classifyProtobufCompatibilityChanges(previousCompatibility, current.protobufCompatibility));
    }
  } else if (provider.contract.kind === 'graphql') {
    const previousCompatibility = parseGraphqlCompatibility(provider.contract.compatibility_json, warnings);
    if (previousCompatibility !== undefined && current.graphqlCompatibility !== undefined) {
      changes.push(...classifyGraphqlCompatibilityChanges(previousCompatibility, current.graphqlCompatibility));
    }
  } else if (provider.contract.kind === 'asyncapi') {
    const previousCompatibility = parseAsyncApiCompatibility(provider.contract.compatibility_json, warnings);
    if (previousCompatibility !== undefined && current.asyncApiCompatibility !== undefined) {
      changes.push(...classifyAsyncApiCompatibilityChanges(previousCompatibility, current.asyncApiCompatibility));
    }
  } else if (provider.contract.kind === 'json-schema') {
    const previousCompatibility = parseJsonSchemaCompatibility(provider.contract.compatibility_json, warnings);
    if (previousCompatibility !== undefined && current.jsonSchemaCompatibility !== undefined) {
      changes.push(...classifyJsonSchemaCompatibilityChanges(previousCompatibility, current.jsonSchemaCompatibility));
    }
  } else if (provider.contract.kind === 'avro') {
    const previousCompatibility = parseAvroCompatibility(provider.contract.compatibility_json, warnings);
    if (previousCompatibility !== undefined && current.avroCompatibility !== undefined) {
      changes.push(...classifyAvroCompatibilityChanges(previousCompatibility, current.avroCompatibility));
    }
  } else {
    const previousCompatibility = parseOpenApiCompatibility(provider.contract.compatibility_json, warnings);
    if (previousCompatibility !== undefined && current.compatibility !== undefined) {
      changes.push(...classifyOpenApiCompatibilityChanges(previousCompatibility, current.compatibility));
    }
  }

  if (changes.length === 0 && current.contentHash !== undefined && current.contentHash !== provider.contract.content_hash) {
    changes.push({
      kind: 'changed_contract_without_endpoint_delta',
      classification: 'unknown',
      reason: 'contract content changed but endpoint surface is unchanged in the v0 analyzer'
    });
  }

  return changes.sort(compareChanges);
}

export function summarizeChanges(
  changes: ContractDiffChange[],
  impactedConsumers: ImpactedContractConsumer[]
): AnalyzeContractDiffResult['summary'] {
  const breakingChangeCount = changes.filter((change) => change.classification === 'breaking').length;
  const nonBreakingChangeCount = changes.filter((change) => change.classification === 'non-breaking').length;
  const unknownChangeCount = changes.filter((change) => change.classification === 'unknown').length;
  const eventTopologyBreakdown = summarizeEventTopology(impactedConsumers);
  return {
    classification: breakingChangeCount > 0
      ? 'breaking'
      : unknownChangeCount > 0
        ? 'unknown'
        : nonBreakingChangeCount > 0
          ? 'non-breaking'
          : 'unchanged',
    breakingChangeCount,
    nonBreakingChangeCount,
    unknownChangeCount,
    impactedConsumerCount: impactedConsumers.length,
    ...(eventTopologyBreakdown.length > 0
      ? {
        eventTopologyCount: eventTopologyBreakdown.reduce((total, item) => total + item.count, 0),
        eventTopologyBreakdown
      }
      : {})
  };
}

export function summarizeEventTopology(impactedConsumers: ImpactedContractConsumer[]): EventTopologySummary[] {
  const byKey = new Map<string, EventTopologySummary>();
  for (const consumer of impactedConsumers) {
    if (consumer.eventTopology === undefined) continue;
    const key = [
      consumer.eventTopology.providerAction,
      consumer.eventTopology.counterpartyRole,
      consumer.eventTopology.pattern
    ].join('\0');
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(key, {
      ...consumer.eventTopology,
      count: 1
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.providerAction.localeCompare(b.providerAction) ||
    a.counterpartyRole.localeCompare(b.counterpartyRole) ||
    a.pattern.localeCompare(b.pattern)
  );
}

export function canPersistDiff(changes: ContractDiffChange[]): boolean {
  return !changes.some((change) =>
    change.kind === 'unreadable_current_contract' || change.kind === 'unparsed_current_contract'
  );
}

export function parseConsumesLink(provenanceJson: string): {
  consumer: { serviceName: string; repoPath: string; path: string };
  provider: { repoPath: string; contractPath: string };
  http: { method: string; path: string };
  evidence: { snippet: string };
  eventTopology?: EventTopologyProvenance;
} | undefined {
  const provenance = parseJsonObject(provenanceJson);
  const consumer = objectAt(provenance, 'consumer');
  const provider = objectAt(provenance, 'provider');
  const http = objectAt(provenance, 'http');
  const evidence = objectAt(provenance, 'evidence');
  const eventTopology = parseEventTopology(objectAt(provenance, 'eventTopology'));
  const parsed = {
    consumer: {
      serviceName: stringAt(consumer, 'serviceName'),
      repoPath: stringAt(consumer, 'repoPath'),
      path: stringAt(consumer, 'path')
    },
    provider: {
      repoPath: stringAt(provider, 'repoPath'),
      contractPath: stringAt(provider, 'contractPath')
    },
    http: {
      method: stringAt(http, 'method'),
      path: stringAt(http, 'path')
    },
    evidence: {
      snippet: stringAt(evidence, 'snippet')
    },
    ...(eventTopology !== undefined ? { eventTopology } : {})
  };
  if (
    !parsed.consumer.serviceName ||
    !parsed.consumer.repoPath ||
    !parsed.consumer.path ||
    !parsed.provider.repoPath ||
    !parsed.provider.contractPath ||
    !parsed.http.method ||
    !parsed.http.path
  ) {
    return undefined;
  }
  return parsed;
}

export function parseEventTopology(value: Record<string, unknown> | undefined): EventTopologyProvenance | undefined {
  if (value === undefined) return undefined;
  const rawCounterpartyRole = stringAt(value, 'counterpartyRole');
  if (rawCounterpartyRole !== 'consumer' && rawCounterpartyRole !== 'producer' && rawCounterpartyRole !== 'unknown') {
    return undefined;
  }
  const parsed = {
    providerAction: stringAt(value, 'providerAction'),
    counterpartyRole: rawCounterpartyRole,
    pattern: stringAt(value, 'pattern')
  } satisfies EventTopologyProvenance;
  if (!parsed.providerAction || !parsed.pattern) return undefined;
  return parsed;
}

export function endpointsByKey(endpoints: ContractEndpoint[]): Map<string, ContractEndpoint> {
  const byKey = new Map<string, ContractEndpoint>();
  for (const endpoint of endpoints) {
    const key = endpointKey(endpoint.httpMethod, endpoint.routePath);
    if (!byKey.has(key)) byKey.set(key, endpoint);
  }
  return byKey;
}

export function currentEndpointId(contractPath: string, endpoint: ContractEndpoint): string {
  const lowerPath = contractPath.toLowerCase();
  const languageId = isAsyncApiContractPath(contractPath)
    ? 'asyncapi'
    : isJsonSchemaContractPath(contractPath)
      ? 'json-schema'
      : lowerPath.endsWith('.avsc')
        ? 'avro'
        : lowerPath.endsWith('.proto')
          ? 'protobuf'
          : lowerPath.endsWith('.graphql') || lowerPath.endsWith('.gql')
            ? 'graphql'
            : lowerPath.endsWith('.json')
              ? 'json'
              : 'yaml';
  if (languageId === 'protobuf' && endpoint.httpMethod === 'RPC') {
    return `endpoint:protobuf:${endpoint.routePath.replace('/', '.')}`;
  }
  if (languageId === 'graphql' && endpoint.httpMethod === 'GRAPHQL') {
    return `endpoint:graphql:${endpoint.routePath}`;
  }
  if (languageId === 'asyncapi') {
    return `endpoint:asyncapi:${endpointKey(endpoint.httpMethod, endpoint.routePath)}`;
  }
  if (languageId === 'json-schema' && endpoint.httpMethod === 'SCHEMA') {
    return `endpoint:json-schema:${endpoint.routePath}`;
  }
  if (languageId === 'avro' && endpoint.httpMethod === 'AVRO') {
    return `endpoint:avro:${endpoint.routePath}`;
  }
  return `endpoint:${languageId}:${endpointKey(endpoint.httpMethod, endpoint.routePath)}`;
}

export function endpointDisplayForContractKind(kind: string, displayName: string): { method: string; path: string } | undefined {
  if (kind === 'protobuf') return parseProtobufEndpointDisplay(displayName);
  if (kind === 'graphql') return parseGraphqlEndpointDisplay(displayName);
  if (kind === 'asyncapi') return parseAsyncApiEndpointDisplay(displayName);
  if (kind === 'json-schema') return parseJsonSchemaEndpointDisplay(displayName);
  if (kind === 'avro') return parseAvroEndpointDisplay(displayName);
  return parseHttpEndpointDisplay(displayName);
}

export function parseHttpEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(\S+)$/i.exec(displayName.trim());
  if (!match) return undefined;
  return { method: match[1]!.toUpperCase(), path: match[2]! };
}

export function parseProtobufEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(displayName.trim());
  if (!match) return undefined;
  return { method: 'RPC', path: `${match[1]!}/${match[2]!}` };
}

export function parseGraphqlEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^(Query|Mutation|Subscription)\.([A-Za-z_]\w*)$/.exec(displayName.trim());
  if (!match) return undefined;
  return { method: 'GRAPHQL', path: `${match[1]!}.${match[2]!}` };
}

export function parseAsyncApiEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^([A-Z][A-Z0-9_-]*)\s+(.+)$/.exec(displayName.trim());
  if (!match) return undefined;
  return { method: match[1]!, path: match[2]! };
}

export function parseJsonSchemaEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^SCHEMA\s+(.+)$/i.exec(displayName.trim());
  if (!match) return undefined;
  return { method: 'SCHEMA', path: match[1]! };
}

export function parseAvroEndpointDisplay(displayName: string): { method: string; path: string } | undefined {
  const match = /^AVRO\s+(.+)$/i.exec(displayName.trim());
  if (!match) return undefined;
  return { method: 'AVRO', path: match[1]! };
}

export function isAsyncApiContractPath(contractPath: string): boolean {
  const basename = path.posix.basename(contractPath);
  return basename.replace(/\.[^.]+$/, '').toLowerCase().includes('asyncapi');
}

export function compareChanges(left: ContractDiffChange, right: ContractDiffChange): number {
  const kindOrder = changeKindOrder(left.kind) - changeKindOrder(right.kind);
  if (kindOrder !== 0) return kindOrder;
  return (
    (left.routePath ?? '').localeCompare(right.routePath ?? '') ||
    (left.httpMethod ?? '').localeCompare(right.httpMethod ?? '') ||
    (left.statusCode ?? '').localeCompare(right.statusCode ?? '') ||
    (left.schemaPath ?? '').localeCompare(right.schemaPath ?? '') ||
    (left.propertyName ?? '').localeCompare(right.propertyName ?? '') ||
    (left.enumValue ?? '').localeCompare(right.enumValue ?? '')
  );
}

export function changeKindOrder(kind: ContractDiffChangeKind): number {
  if (kind === 'added_endpoint') return 0;
  if (kind === 'removed_endpoint') return 1;
  if (kind === 'removed_response_status') return 2;
  if (kind === 'removed_response_required_property') return 3;
  if (kind === 'removed_response_optional_property') return 4;
  if (kind === 'changed_response_property_type') return 5;
  if (kind === 'removed_response_property_enum_value') return 6;
  if (kind === 'changed_response_property_format') return 7;
  if (kind === 'added_response_property_nullable') return 8;
  if (kind === 'added_request_required_property') return 9;
  if (kind === 'removed_request_property_enum_value') return 10;
  if (kind === 'changed_request_property_format') return 11;
  if (kind === 'changed_request_property_type') return 12;
  return 13;
}

export function dedupeConsumers(consumers: ImpactedContractConsumer[]): ImpactedContractConsumer[] {
  const byKey = new Map<string, ImpactedContractConsumer>();
  for (const consumer of consumers) {
    const key = [
      consumer.consumerRepoPath,
      consumer.consumerPath,
      consumer.providerRepoPath,
      consumer.providerContractPath,
      consumer.httpMethod,
      consumer.routePath
    ].join('\0');
    if (!byKey.has(key)) byKey.set(key, consumer);
  }
  return [...byKey.values()];
}

export function compareConsumers(left: ImpactedContractConsumer, right: ImpactedContractConsumer): number {
  return (
    left.consumerService.localeCompare(right.consumerService) ||
    left.consumerPath.localeCompare(right.consumerPath) ||
    left.providerService.localeCompare(right.providerService) ||
    left.httpMethod.localeCompare(right.httpMethod) ||
    left.routePath.localeCompare(right.routePath)
  );
}

export function breakingLinkId(workspaceId: number, link: PersistableBreakLink): string {
  return contentHash(
    ANALYZER_ID,
    String(workspaceId),
    link.consumer.consumerRepoPath,
    link.consumer.consumerPath,
    link.consumer.providerRepoPath,
    link.consumer.providerContractPath,
    link.consumer.httpMethod,
    link.consumer.routePath,
    changeFingerprint(link.change)
  ).slice(0, 24);
}

export function breakingLinkProvenance(link: PersistableBreakLink): string {
  return stableJson({
    schemaVersion: 1,
    analyzer: ANALYZER_ID,
    classification: link.change.classification,
    consumer: {
      serviceName: link.consumer.consumerService,
      repoPath: link.consumer.consumerRepoPath,
      path: link.consumer.consumerPath
    },
    provider: {
      serviceName: link.consumer.providerService,
      repoPath: link.consumer.providerRepoPath,
      contractPath: link.consumer.providerContractPath
    },
    change: {
      kind: link.change.kind,
      method: link.consumer.httpMethod,
      path: link.consumer.routePath,
      ...(link.change.previousEndpointId !== undefined ? { previousEndpointId: link.change.previousEndpointId } : {}),
      ...(link.change.currentEndpointId !== undefined ? { currentEndpointId: link.change.currentEndpointId } : {}),
      ...(link.change.statusCode !== undefined ? { statusCode: link.change.statusCode } : {}),
      ...(link.change.propertyName !== undefined ? { propertyName: link.change.propertyName } : {}),
      ...(link.change.schemaPath !== undefined ? { schemaPath: link.change.schemaPath } : {}),
      ...(link.change.previousSchemaType !== undefined ? { previousSchemaType: link.change.previousSchemaType } : {}),
      ...(link.change.currentSchemaType !== undefined ? { currentSchemaType: link.change.currentSchemaType } : {}),
      ...(link.change.enumValue !== undefined ? { enumValue: link.change.enumValue } : {}),
      ...(link.change.previousEnumValues !== undefined ? { previousEnumValues: link.change.previousEnumValues } : {}),
      ...(link.change.currentEnumValues !== undefined ? { currentEnumValues: link.change.currentEnumValues } : {}),
      ...(link.change.previousFormat !== undefined ? { previousFormat: link.change.previousFormat } : {}),
      ...(link.change.currentFormat !== undefined ? { currentFormat: link.change.currentFormat } : {}),
      ...(link.change.previousNullable !== undefined ? { previousNullable: link.change.previousNullable } : {}),
      ...(link.change.currentNullable !== undefined ? { currentNullable: link.change.currentNullable } : {})
    },
    ...(link.consumer.eventTopology !== undefined ? { eventTopology: link.consumer.eventTopology } : {}),
    evidence: {
      filePath: link.consumer.consumerPath,
      snippet: link.consumer.evidenceSnippet
    }
  });
}

export function changeFingerprint(change: ContractDiffChange): string {
  return stableJson({
    kind: change.kind,
    method: change.httpMethod,
    path: change.routePath,
    statusCode: change.statusCode,
    propertyName: change.propertyName,
    schemaPath: change.schemaPath,
    previousSchemaType: change.previousSchemaType,
    currentSchemaType: change.currentSchemaType,
    enumValue: change.enumValue,
    previousEnumValues: change.previousEnumValues,
    currentEnumValues: change.currentEnumValues,
    previousFormat: change.previousFormat,
    currentFormat: change.currentFormat,
    previousNullable: change.previousNullable,
    currentNullable: change.currentNullable
  });
}

export function normalizeContractPath(contractPath: string): string {
  if (!contractPath || contractPath.includes('\0') || path.isAbsolute(contractPath)) {
    throw new Error('contract path must be repo-relative');
  }
  const normalized = path.posix.normalize(contractPath.split(path.sep).join('/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..')
  ) {
    throw new Error('contract path must be repo-relative');
  }
  return normalized.replace(/^\.\//, '');
}

export function objectAt(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = source?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function stringAt(source: Record<string, unknown> | undefined, key: string): string {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
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

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
export type ContractProviderBaseline = {
  repoPath: string;
  serviceName: string;
  repoId: number;
  indexRunId: number;
  contract: ContractBaselineRow;
};

export function planBreakingLinks(impactedConsumers: ImpactedContractConsumer[], changes: ContractDiffChange[]): PersistableBreakLink[] {
  const breakingByKey = new Map(
    changes.reduce<Array<[string, ContractDiffChange[]]>>((entries, change) => {
      if (change.classification !== 'breaking' || !change.httpMethod || !change.routePath) return entries;
      const key = endpointKey(change.httpMethod, change.routePath);
      const existing = entries.find(([entryKey]) => entryKey === key);
      if (existing) {
        existing[1].push(change);
      } else {
        entries.push([key, [change]]);
      }
      return entries;
    }, [])
  );
  const links = impactedConsumers.flatMap((consumer): PersistableBreakLink[] => {
    const endpointChanges = breakingByKey.get(endpointKey(consumer.httpMethod, consumer.routePath)) ?? [];
    return endpointChanges.map((change) => ({ consumer, change }));
  });

  return links;
}

export function impactedConsumersForLinks(rows: ConsumesLinkRow[], provider: ContractProviderBaseline, contractPath: string, breakingEndpointKeys: Set<string>): ImpactedContractConsumer[] {
  const consumers: ImpactedContractConsumer[] = [];
  for (const row of rows) {
    const link = parseConsumesLink(row.provenance);
    if (!link) continue;
    if (link.provider.repoPath !== provider.repoPath) continue;
    if (link.provider.contractPath !== contractPath) continue;
    if (!breakingEndpointKeys.has(endpointKey(link.http.method, link.http.path))) continue;
    consumers.push({
      consumerService: link.consumer.serviceName,
      consumerRepoPath: link.consumer.repoPath,
      consumerPath: link.consumer.path,
      providerService: provider.serviceName,
      providerRepoPath: provider.repoPath,
      providerContractPath: contractPath,
      httpMethod: link.http.method,
      routePath: link.http.path,
      evidenceSnippet: link.evidence.snippet,
      ...(link.eventTopology !== undefined ? { eventTopology: link.eventTopology } : {})
    });
  }
  return dedupeConsumers(consumers).sort(compareConsumers);
}
