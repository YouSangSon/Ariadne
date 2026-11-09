import { isRecord, parseJsonObject } from "../../domain/context/evidence.js";
import type { CompactEvidenceResource } from "../../domain/context/evidence.js";
import type { EventTopologyProvenance } from "../../domain/contracts/contract-diff.js";
import { asConfidence } from "../../domain/impact/confidence.js";
import type { EntityRef } from "../../domain/model.js";
import type { EvidenceResourceRow, ExplainEntityRow, ExplainRelationRow } from "./resource-model.js";

export function parsedProvenance(value: string): unknown {
  const parsed = parseJsonObject(value);
  return Object.keys(parsed).length > 0 ? parsed : value;
}

export function eventTopologyFromProvenance(provenance: unknown): EventTopologyProvenance | undefined {
  if (!isRecord(provenance) || !isRecord(provenance.eventTopology)) return undefined;
  const providerAction = provenance.eventTopology.providerAction;
  const counterpartyRole = provenance.eventTopology.counterpartyRole;
  const pattern = provenance.eventTopology.pattern;
  if (typeof providerAction !== 'string' || typeof pattern !== 'string') return undefined;
  if (!providerAction || !pattern) return undefined;
  if (counterpartyRole !== 'consumer' && counterpartyRole !== 'producer' && counterpartyRole !== 'unknown') {
    return undefined;
  }
  return { providerAction, counterpartyRole, pattern };
}

export function explainRelation(
  row: ExplainRelationRow,
  evidenceByRelation: ReadonlyMap<string, CompactEvidenceResource[]>
): unknown {
  return {
    id: row.relation_id,
    kind: row.relation_kind,
    confidence: asConfidence(row.relation_confidence),
    provenance: row.relation_provenance,
    sourceEntity: entityFromExplainRelationRow(row, 'source'),
    targetEntity: entityFromExplainRelationRow(row, 'target'),
    evidence: evidenceByRelation.get(row.relation_id) ?? []
  };
}

export function entityFromExplainRow(row: ExplainEntityRow): EntityRef {
  return {
    id: row.id,
    kind: row.kind as EntityRef['kind'],
    ...(row.path !== null ? { path: row.path } : {}),
    ...(row.symbol !== null ? { symbol: row.symbol } : {}),
    ...(row.language_id !== null ? { languageId: row.language_id } : {}),
    displayName: row.display_name
  };
}

export function entityFromExplainRelationRow(row: ExplainRelationRow, prefix: 'source' | 'target'): EntityRef {
  const id = prefix === 'source' ? row.source_id : row.target_id;
  const kind = prefix === 'source' ? row.source_kind : row.target_kind;
  const filePath = prefix === 'source' ? row.source_path : row.target_path;
  const symbol = prefix === 'source' ? row.source_symbol : row.target_symbol;
  const languageId = prefix === 'source' ? row.source_language_id : row.target_language_id;
  const displayName = prefix === 'source' ? row.source_display_name : row.target_display_name;
  return {
    id,
    kind: kind as EntityRef['kind'],
    ...(filePath !== null ? { path: filePath } : {}),
    ...(symbol !== null ? { symbol } : {}),
    ...(languageId !== null ? { languageId } : {}),
    displayName
  };
}

export function entityFromEvidenceRow(row: EvidenceResourceRow, prefix: 'source' | 'target'): EntityRef {
  const id = prefix === 'source' ? row.source_id! : row.target_id!;
  const kind = prefix === 'source' ? row.source_kind! : row.target_kind!;
  const path = prefix === 'source' ? row.source_path : row.target_path;
  const symbol = prefix === 'source' ? row.source_symbol : row.target_symbol;
  const languageId = prefix === 'source' ? row.source_language_id : row.target_language_id;
  const displayName = prefix === 'source' ? row.source_display_name : row.target_display_name;
  return {
    id,
    kind: kind as EntityRef['kind'],
    ...(path !== null ? { path } : {}),
    ...(symbol !== null ? { symbol } : {}),
    ...(languageId !== null ? { languageId } : {}),
    displayName: displayName ?? id
  };
}