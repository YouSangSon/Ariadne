import type { SearchContextDisabledStream, SearchEntityRow, SearchEvidenceRow } from "../../domain/context/search.js";
import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";

export interface SearchReader {
  readonly indexRunId: number;
  keyword(query: string): SearchEntityRow[];
  relations(query: string): SearchEntityRow[];
  evidence(query: string, disabled: ReadonlySet<SearchContextDisabledStream>): SearchEntityRow[];
  facts(query: string, disabled: ReadonlySet<SearchContextDisabledStream>): SearchEntityRow[];
  semantic(embedding: EmbeddingResult): SearchEntityRow[];
  graphProximity(seeds: SearchEntityRow[], k: number): SearchEntityRow[];
  entityEvidence(entityId: string, query: string, limit: number): SearchEvidenceRow[];
  close(): void;
}
export interface ContextSearchPorts {
  normalizeRoot(root: string): string;
  embeddingModel(): string;
  hasEmbeddings(root: string, model: string): boolean;
  embed(text: string): Promise<EmbeddingResult>;
  openSession(root: string): SearchReader;
}
