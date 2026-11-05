import { createHash } from "node:crypto";
import path from "node:path";
import { entityKindForPath, isTestPath as isSharedTestPath, languageIdForPath } from "../indexing/entity-classification.js";
import type { Confidence, EntityKind, EntityRef, Evidence } from "../model.js";
import { asConfidence } from "./confidence.js";

export type ImpactRow = {
  sourcePath: string;
  sourceEntity: EntityRef;
  reason: string;
  relationKind: string;
  confidence: Confidence;
  evidence: Evidence;
  depth: number;
  relationPath: string[];
};

export type CanonicalImpactRow = {
  relation_id: string;
  relation_kind: string;
  relation_confidence: string;
  provenance: string;
  source_entity_id: string;
  source_kind: string;
  source_path: string | null;
  source_symbol: string | null;
  source_language_id: string | null;
  source_display_name: string;
  target_entity_id: string;
  target_kind: string;
  target_path: string | null;
  target_symbol: string | null;
  target_language_id: string | null;
  target_display_name: string;
  evidence_id: string | null;
  evidence_file_path: string | null;
  evidence_kind: string | null;
  evidence_snippet: string | null;
  evidence_confidence: string | null;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  evidence_start_col: number | null;
  evidence_end_col: number | null;
};

export type CanonicalContextEvidenceRow = {
  relation_id: string;
  relation_kind: string;
  relation_confidence: string;
  target_entity_id: string;
  target_kind: string;
  target_path: string | null;
  target_symbol: string | null;
  target_language_id: string | null;
  target_display_name: string;
  evidence_id: string;
  evidence_file_path: string;
  evidence_kind: string;
  evidence_snippet: string;
  evidence_confidence: string;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  evidence_start_col: number | null;
  evidence_end_col: number | null;
};

export type TraversalNode = {
  entityId: string;
  label: string;
  relationPath: string[];
  trail: string[];
};

export interface ImpactNeighborReader {
  inboundRelations(targetEntityId: string, limit: number): CanonicalImpactRow[];
}

export function traverseImpact(
  reader: ImpactNeighborReader,
  changedEntityId: string,
  changedFile: string,
  maxDepth: number,
  maxFanout: number,
  warnings: string[]
): ImpactRow[] {
  const out: ImpactRow[] = [];
  const visitedRelations = new Set<string>();
  const bestEntityDepth = new Map<string, number>([[changedEntityId, 0]]);
  let frontier: TraversalNode[] = [{
    entityId: changedEntityId,
    label: changedFile,
    relationPath: [],
    trail: [changedEntityId]
  }];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: TraversalNode[] = [];
    for (const node of frontier) {
      const rows = reader.inboundRelations(node.entityId, maxFanout + 1);
      if (rows.length > maxFanout) {
        warnings.push(`fanout limit: ${node.label} has more than ${maxFanout} inbound relations; analysis truncated at depth ${depth}`);
      }

      for (const row of rows.slice(0, maxFanout)) {
        if (visitedRelations.has(row.relation_id)) continue;
        visitedRelations.add(row.relation_id);
        const confidence = asConfidence(row.relation_confidence);
        const sourceEntity = entityFromCanonicalRow(row);
        const relationKind = row.relation_kind;
        const relationPath = [
          relationStep(sourceEntity, relationKind, node.label),
          ...node.relationPath
        ];
        out.push({
          sourcePath: row.source_path!,
          sourceEntity,
          reason: depth === 1 ? reasonForCanonicalRelation(relationKind, changedFile) : relationPath.join(' -> '),
          relationKind,
          confidence,
          evidence: evidenceFromCanonicalRow(row, sourceEntity, relationKind, confidence),
          depth,
          relationPath
        });

        if (node.trail.includes(row.source_entity_id)) {
          warnings.push(`cycle avoided: ${row.source_display_name} already appears in the traversal path`);
          continue;
        }
        const previousDepth = bestEntityDepth.get(row.source_entity_id);
        if (previousDepth !== undefined && previousDepth <= depth) continue;
        bestEntityDepth.set(row.source_entity_id, depth);
        nextFrontier.push({
          entityId: row.source_entity_id,
          label: sourceEntity.displayName ?? sourceEntity.path ?? sourceEntity.id,
          relationPath,
          trail: [...node.trail, row.source_entity_id]
        });
      }
    }
    frontier = nextFrontier;
  }

  return out;
}

export function relationStep(sourceEntity: EntityRef, relationKind: string, targetLabel: string): string {
  const sourceLabel = sourceEntity.displayName ?? sourceEntity.path ?? sourceEntity.id;
  const verb = relationVerb(relationKind);
  return `${sourceLabel} ${verb} ${targetLabel}`;
}

export function relationVerb(kind: string): string {
  if (kind === 'DEPENDS_ON') return 'depends on';
  if (kind === 'VERIFIES') return 'verifies';
  if (kind === 'DOCUMENTS') return 'documents';
  if (kind === 'PROPOSES') return 'proposes';
  if (kind === 'REQUIRES') return 'requires';
  if (kind === 'CONFIGURES') return 'configures';
  if (kind === 'DEPLOYS') return 'deploys';
  if (kind === 'CALLS') return 'calls';
  if (kind === 'REFERENCES') return 'references';
  if (kind === 'CONSUMES') return 'consumes';
  if (kind === 'IMPLEMENTS') return 'implements';
  if (kind === 'PRODUCES') return 'produces';
  if (kind === 'CO_CHANGES') return 'co-changes with';
  return kind.toLowerCase();
}

export function entityFromCanonicalRow(row: CanonicalImpactRow): EntityRef {
  const kind = isEntityKind(row.source_kind) ? row.source_kind : 'file';
  return {
    id: row.source_entity_id,
    kind,
    ...(row.source_path ? { path: row.source_path } : {}),
    ...(row.source_symbol ? { symbol: row.source_symbol } : {}),
    ...(row.source_language_id ? { languageId: row.source_language_id } : {}),
    displayName: row.source_display_name
  };
}

export function targetEntityFromCanonicalRow(row: CanonicalImpactRow | CanonicalContextEvidenceRow): EntityRef {
  const kind = isEntityKind(row.target_kind) ? row.target_kind : 'file';
  return {
    id: row.target_entity_id,
    kind,
    ...(row.target_path ? { path: row.target_path } : {}),
    ...(row.target_symbol ? { symbol: row.target_symbol } : {}),
    ...(row.target_language_id ? { languageId: row.target_language_id } : {}),
    displayName: row.target_display_name
  };
}

export function evidenceFromCanonicalRow(
  row: CanonicalImpactRow,
  sourceEntity: EntityRef,
  relationKind: string,
  confidence: Confidence
): Evidence {
  return {
    id: row.evidence_id ?? createHash('sha1').update(`${row.relation_id}:${row.source_path}`).digest('hex').slice(0, 16),
    file: row.evidence_file_path ?? row.source_path ?? '',
    kind: row.evidence_kind ?? relationKind,
    snippet: row.evidence_snippet ?? '',
    confidence: asConfidence(row.evidence_confidence ?? confidence),
    ...(row.evidence_start_line !== null ? { startLine: row.evidence_start_line } : {}),
    ...(row.evidence_end_line !== null ? { endLine: row.evidence_end_line } : {}),
    ...(row.evidence_start_col !== null ? { startCol: row.evidence_start_col } : {}),
    ...(row.evidence_end_col !== null ? { endCol: row.evidence_end_col } : {}),
    subject: sourceEntity,
    target: targetEntityFromCanonicalRow(row),
    relationKind,
    relationConfidence: confidence,
    extractorId: 'canonical-entity-graph'
  };
}

export function evidenceFromContextRow(row: CanonicalContextEvidenceRow, sourceEntity: EntityRef): Evidence {
  return {
    id: row.evidence_id,
    file: row.evidence_file_path,
    kind: row.evidence_kind,
    snippet: row.evidence_snippet,
    confidence: asConfidence(row.evidence_confidence || row.relation_confidence),
    ...(row.evidence_start_line !== null ? { startLine: row.evidence_start_line } : {}),
    ...(row.evidence_end_line !== null ? { endLine: row.evidence_end_line } : {}),
    ...(row.evidence_start_col !== null ? { startCol: row.evidence_start_col } : {}),
    ...(row.evidence_end_col !== null ? { endCol: row.evidence_end_col } : {}),
    subject: sourceEntity,
    target: targetEntityFromCanonicalRow(row),
    relationKind: row.relation_kind,
    relationConfidence: asConfidence(row.relation_confidence),
    extractorId: 'canonical-entity-graph'
  };
}

export function reasonForCanonicalRelation(kind: string, changedFile: string): string {
  if (kind === 'DEPENDS_ON') return `depends on ${changedFile}`;
  if (kind === 'VERIFIES') return `verifies ${changedFile}`;
  if (kind === 'DOCUMENTS') return `documents ${changedFile}`;
  if (kind === 'PROPOSES') return `proposes ${changedFile}`;
  if (kind === 'REQUIRES') return `requires ${changedFile}`;
  if (kind === 'CONFIGURES') return `configures ${changedFile}`;
  if (kind === 'DEPLOYS') return `deploys ${changedFile}`;
  if (kind === 'REFERENCES') return `references ${changedFile}`;
  if (kind === 'CALLS') return `calls ${changedFile}`;
  if (kind === 'GOVERNS') return `governs ${changedFile}`;
  if (kind === 'IMPLEMENTS') return `implements ${changedFile}`;
  if (kind === 'CONSUMES') return `consumes ${changedFile}`;
  if (kind === 'PRODUCES') return `produces ${changedFile}`;
  if (kind === 'CO_CHANGES') return `co-changes with ${changedFile}`;
  return `${kind.toLowerCase()} ${changedFile}`;
}

export function reasonForLegacyRelation(kind: string, changedFile: string): string {
  if (kind === 'IMPORTS') return `imports ${changedFile}`;
  if (kind === 'TESTS') return `tests ${changedFile}`;
  if (kind === 'DOCUMENTS') return `documents ${changedFile}`;
  if (kind === 'PROPOSES') return `proposes ${changedFile}`;
  if (kind === 'REQUIRES') return `requires ${changedFile}`;
  if (kind === 'REFERENCES') return `references ${changedFile}`;
  if (kind === 'CONFIGURES') return `configures ${changedFile}`;
  if (kind === 'CALLS') return `calls ${changedFile}`;
  if (kind === 'GOVERNS') return `governs ${changedFile}`;
  if (kind === 'IMPLEMENTS') return `implements ${changedFile}`;
  return `${kind.toLowerCase()} ${changedFile}`;
}

export function isEntityKind(value: string): value is EntityKind {
  return [
    'file',
    'symbol',
    'module',
    'package',
    'test',
    'doc',
    'config',
    'policy',
    'proposal',
    'prd',
    'workflow',
    'resource',
    'endpoint',
    'contract',
    'event',
    'business_plan',
    'requirement',
    'decision',
    'meeting_note',
    'metric',
    'customer_artifact',
    'task',
    'external_entity'
  ].includes(value);
}

export function normalizeBoundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

export function isBetterImpact(
  next: { confidence: Confidence; depth: number },
  current: { confidence: Confidence; depth: number }
): boolean {
  if (next.depth !== current.depth) return next.depth < current.depth;
  return confidenceRank(next.confidence) > confidenceRank(current.confidence);
}

export function confidenceRank(confidence: Confidence): number {
  if (confidence === 'proven') return 3;
  if (confidence === 'inferred') return 2;
  if (confidence === 'heuristic') return 1;
  return 0;
}

export function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  return [...new Map(evidence.map((item) => [item.id, item])).values()].sort((a, b) => a.file.localeCompare(b.file));
}

export function entityForPath(relativePath: string): EntityRef {
  const languageId = languageIdForPath(relativePath);
  return {
    id: `file:${relativePath}`,
    kind: entityKindForPath(relativePath, languageId),
    path: relativePath,
    displayName: relativePath,
    ...(languageId ? { languageId } : {})
  };
}

export function isJavaScriptTestPath(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return isSharedTestPath(relativePath) && /\.[cm]?[tj]sx?$/.test(basename);
}

export function shellQuote(value: string): string {
  const displayValue = value
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (/^[A-Za-z0-9_./:-]+$/.test(displayValue) && !displayValue.startsWith('-')) return displayValue;
  return `'${displayValue.replace(/'/g, `'\\''`)}'`;
}