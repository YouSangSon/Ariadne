import type { ExplainEvidenceRow } from "../../domain/context/evidence.js";
import type { ExplainEntityRow, ExplainRelationRow } from "./resource-model.js";

export interface EntityExplanationSession {
  indexRunId: number;
  entity(id: string): ExplainEntityRow | undefined;
  relationCount(direction: 'incoming' | 'outgoing', id: string): number;
  relations(direction: 'incoming' | 'outgoing', id: string, limit: number): ExplainRelationRow[];
  evidence(ids: string[], limit: number): ExplainEvidenceRow[];
  evidenceCount(ids: string[]): number;
  close(): void;
}
