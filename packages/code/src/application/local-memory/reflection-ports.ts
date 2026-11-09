import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";
import type { EntityCandidates, ReflectedEntity, ReflectionDraft } from "../../domain/local-memory/reflection.js";
import type { ReflectionResult, SummarizeInput } from "../../domain/local-memory/summarizer.js";

export interface ReflectionPorts {
  repository: {
    candidates(root: string, branch: string, cutoff: string, entity: string | undefined, cap: number): Map<string, EntityCandidates>;
    persist(root: string, branch: string, drafts: ReflectionDraft[], agent: string | undefined, olderThanDays: number): ReflectedEntity[];
  };
  maxFactsPerEntity(): number;
  summarize(input: SummarizeInput): Promise<ReflectionResult>;
  embed(text: string): Promise<EmbeddingResult>;
}
