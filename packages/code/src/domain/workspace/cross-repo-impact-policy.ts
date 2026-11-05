import { createHash } from "node:crypto";
import path from "node:path";
import { parseJsonObject } from "../contracts/diff/shared.js";
import { asConfidence } from "../impact/confidence.js";
import type { CrossRepoImpact } from "../model.js";
import type { CrossRepoImpactCandidate, CrossRepoImpactLoadResult } from "./cross-repo-impact.js";
import { workspaceResources } from "./resources.js";

export type ContractRow = {
  service_name: string | null;
};

export type BreakLinkRow = {
  id: string;
  workspace_name: string;
  confidence: string;
  provenance: string;
};

export type ParsedBreakLink = {
  consumer: {
    serviceName: string;
    repoPath?: string;
    path: string;
  };
  provider: {
    serviceName: string;
    repoPath?: string;
    contractPath: string;
  };
  change: {
    kind: string;
    method?: string;
    path?: string;
    previousEndpointId?: string;
  };
  evidence: {
    filePath: string;
    snippet: string;
  };
};

export function parseBreakLink(provenanceJson: string): ParsedBreakLink | undefined {
  const provenance = parseJsonObject(provenanceJson);
  if (!provenance) return undefined;
  const consumer = objectAt(provenance, 'consumer');
  const provider = objectAt(provenance, 'provider');
  const change = objectAt(provenance, 'change');
  const evidence = objectAt(provenance, 'evidence');
  const consumerRepoPath = optionalStringAt(consumer, 'repoPath');
  const providerRepoPath = optionalStringAt(provider, 'repoPath');
  const changeMethod = optionalStringAt(change, 'method');
  const changePath = optionalStringAt(change, 'path');
  const previousEndpointId = optionalStringAt(change, 'previousEndpointId');
  const parsed: ParsedBreakLink = {
    consumer: {
      serviceName: stringAt(consumer, 'serviceName'),
      ...(consumerRepoPath ? { repoPath: consumerRepoPath } : {}),
      path: stringAt(consumer, 'path')
    },
    provider: {
      serviceName: stringAt(provider, 'serviceName'),
      ...(providerRepoPath ? { repoPath: providerRepoPath } : {}),
      contractPath: stringAt(provider, 'contractPath')
    },
    change: {
      kind: stringAt(change, 'kind'),
      ...(changeMethod ? { method: changeMethod } : {}),
      ...(changePath ? { path: changePath } : {}),
      ...(previousEndpointId ? { previousEndpointId } : {})
    },
    evidence: {
      filePath: stringAt(evidence, 'filePath'),
      snippet: stringAt(evidence, 'snippet')
    }
  };

  if (
    !parsed.provider.serviceName ||
    !parsed.provider.contractPath ||
    !parsed.consumer.serviceName ||
    !parsed.consumer.path ||
    !parsed.change.kind ||
    !parsed.evidence.filePath ||
    !parsed.evidence.snippet
  ) {
    return undefined;
  }
  return parsed;
}

export function objectAt(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const child = value?.[key];
  return child && typeof child === 'object' && !Array.isArray(child)
    ? child as Record<string, unknown>
    : undefined;
}

export function stringAt(value: Record<string, unknown> | undefined, key: string): string {
  const child = value?.[key];
  return typeof child === 'string' ? child : '';
}

export function optionalStringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const child = stringAt(value, key);
  return child.length > 0 ? child : undefined;
}

export function publicRepoPath(repoPath: string | undefined): string | undefined {
  if (!repoPath || isAbsolutePath(repoPath)) return undefined;
  return repoPath;
}

export function publicFilePath(filePath: string, fallbackDisplayPath: string): string {
  return isAbsolutePath(filePath) ? fallbackDisplayPath : filePath;
}

export function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

export function dedupeCandidates(candidates: CrossRepoImpactCandidate[]): CrossRepoImpactCandidate[] {
  const deduped = new Map<string, CrossRepoImpactCandidate>();
  for (const candidate of candidates.sort(compareCandidates)) {
    const key = [
      candidate.affectedFile.path,
      candidate.evidence.relationKind ?? candidate.evidence.kind,
      candidate.evidence.target?.id ?? '',
      candidate.evidence.id
    ].join('\0');
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return [...deduped.values()].sort(compareCandidates);
}

export function compareCandidates(left: CrossRepoImpactCandidate, right: CrossRepoImpactCandidate): number {
  return left.affectedFile.path.localeCompare(right.affectedFile.path)
    || (left.evidence.relationKind ?? left.evidence.kind).localeCompare(right.evidence.relationKind ?? right.evidence.kind)
    || (left.evidence.target?.id ?? '').localeCompare(right.evidence.target?.id ?? '')
    || left.evidence.id.localeCompare(right.evidence.id);
}
export function projectCrossRepoImpacts(
  input: { rows: BreakLinkRow[]; contract: ContractRow; repoRoot: string; changedFile: string; indexRunId: number },
  providerRepoMatches: (path: string | undefined, root: string) => boolean
): CrossRepoImpactLoadResult {
  const { rows, contract, repoRoot, changedFile, indexRunId } = input;
  const candidates: CrossRepoImpactCandidate[] = [];
  let malformedLinkCount = 0;
  for (const row of rows) {
    const parsed = parseBreakLink(row.provenance);
    if (!parsed) {
      malformedLinkCount += 1;
      continue;
    }
    if (parsed.provider.contractPath !== changedFile) continue;
    if (!providerRepoMatches(parsed.provider.repoPath, repoRoot)) continue;

    const workspaceName = row.workspace_name;
    if (!workspaceName) {
      malformedLinkCount += 1;
      continue;
    }

    const confidence = asConfidence(row.confidence);
    const displayPath = `${parsed.consumer.serviceName}:${parsed.consumer.path}`;
    const providerDisplayPath = `${parsed.provider.serviceName}:${parsed.provider.contractPath}`;
    const relationPath = [`${displayPath} BREAKS_COMPATIBILITY_WITH ${providerDisplayPath}`];
    const subject = {
      id: `cross-repo:${workspaceName}:${displayPath}`,
      kind: 'external_entity' as const,
      path: displayPath,
      displayName: displayPath
    };
    const target = {
      id: `contract:${providerDisplayPath}`,
      kind: 'contract' as const,
      path: parsed.provider.contractPath,
      displayName: providerDisplayPath
    };
    const resources = workspaceResources(workspaceName);
    const publicProviderRepoPath = publicRepoPath(parsed.provider.repoPath);
    const publicConsumerRepoPath = publicRepoPath(parsed.consumer.repoPath);
    const publicEvidenceFilePath = publicFilePath(parsed.evidence.filePath, displayPath);
    const evidenceId = createHash('sha1')
      .update(`${row.id}:${displayPath}:BREAKS_COMPATIBILITY_WITH:${providerDisplayPath}`)
      .digest('hex')
      .slice(0, 16);

    const impact: CrossRepoImpact = {
      workspace: workspaceName,
      provider: {
        serviceName: parsed.provider.serviceName || contract.service_name || '',
        ...(publicProviderRepoPath ? { repoPath: publicProviderRepoPath } : {}),
        contractPath: parsed.provider.contractPath
      },
      consumer: {
        serviceName: parsed.consumer.serviceName,
        ...(publicConsumerRepoPath ? { repoPath: publicConsumerRepoPath } : {}),
        path: parsed.consumer.path
      },
      change: parsed.change,
      confidence,
      evidence: {
        filePath: publicEvidenceFilePath,
        snippet: parsed.evidence.snippet
      },
      resources: {
        workspace: resources.workspace,
        crossRepoLinks: resources.crossRepoLinks
      }
    };

    candidates.push({
      impact,
      affectedFile: {
        path: displayPath,
        reason: `breaks cross-repo consumer ${parsed.consumer.serviceName} via ${parsed.provider.contractPath}`,
        confidence,
        depth: 1,
        relationPath
      },
      affectedTarget: {
        target: subject,
        relations: relationPath,
        confidence
      },
      evidence: {
        id: evidenceId,
        file: displayPath,
        kind: 'BREAKS_COMPATIBILITY_WITH',
        snippet: parsed.evidence.snippet,
        confidence,
        subject,
        target,
        relationKind: 'BREAKS_COMPATIBILITY_WITH',
        relationConfidence: confidence,
        extractorId: 'cross-repo-contract-impact'
      }
    });
  }

  return {
    candidates: dedupeCandidates(candidates),
    malformedLinkCount
  };
}
