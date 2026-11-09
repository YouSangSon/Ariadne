import { entityResourceUri, evidenceResourceUri } from "../../domain/context/context-pack.js";
import { compactEvidenceResource } from "../../domain/context/evidence.js";
import type { CompactEvidenceResource } from "../../domain/context/evidence.js";
import { typedMcpError } from "./errors.js";
import type { McpContext } from "./request.js";
import type { EntityExplainOptions } from "./resource-model.js";
import type { EntityExplanationSession } from "./resource-ports.js";
import { entityFromExplainRow, explainRelation } from "./resource-projection.js";

export function explainEntity(context: McpContext, options: EntityExplainOptions, open: (root: string) => EntityExplanationSession): unknown {
  const session = open(context.repoRoot);
  try {
    const indexRunId = session.indexRunId;
    const entity = session.entity(options.entityId);
    if (!entity) throw typedMcpError(new Error(`impact entity not found: ${options.entityId}`), 'resource_not_found');

    const incomingCount = session.relationCount('incoming', options.entityId);
    const outgoingCount = session.relationCount('outgoing', options.entityId);
    const incomingRows = session.relations('incoming', options.entityId, options.relationLimit);
    const outgoingRows = session.relations('outgoing', options.entityId, options.relationLimit);
    const selectedRelationIds = [...incomingRows, ...outgoingRows].map((row) => row.relation_id);
    const evidenceRows = session.evidence(selectedRelationIds, options.evidenceLimit + 1);
    const evidenceCount = session.evidenceCount(selectedRelationIds);
    const selectedEvidenceRows = evidenceRows.slice(0, options.evidenceLimit);
    const evidenceByRelation = new Map<string, CompactEvidenceResource[]>();
    for (const row of selectedEvidenceRows) {
      const item = compactEvidenceResource(row);
      const bucket = evidenceByRelation.get(row.relation_id) ?? [];
      bucket.push(item);
      evidenceByRelation.set(row.relation_id, bucket);
    }
    const evidenceUris = selectedEvidenceRows.map((row) => evidenceResourceUri(row.evidence_id));

    return {
      entity: entityFromExplainRow(entity),
      indexRunId,
      relations: {
        incoming: incomingRows.map((row) => explainRelation(row, evidenceByRelation)),
        outgoing: outgoingRows.map((row) => explainRelation(row, evidenceByRelation))
      },
      resources: {
        entity: entityResourceUri(entityFromExplainRow(entity)),
        evidence: [...new Set(evidenceUris)].sort()
      },
      limits: {
        relationLimit: options.relationLimit,
        evidenceLimit: options.evidenceLimit,
        snippetChars: 300,
        incomingTruncated: incomingCount > options.relationLimit,
        outgoingTruncated: outgoingCount > options.relationLimit,
        evidenceTruncated: evidenceCount > options.evidenceLimit
      },
      counts: {
        incoming: incomingCount,
        outgoing: outgoingCount,
        evidence: evidenceCount
      }
    };
  } finally { session.close(); }
}