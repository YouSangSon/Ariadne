import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";
import type { RecallInput, RecallResult, ReembedCandidate, RememberInput, RememberResult } from "../../domain/local-memory/model.js";

export interface LocalMemoryRepository {
  recall(root: string, input: RecallInput): RecallResult;
  recallSemantic(root: string, embedding: EmbeddingResult, input: RecallInput): RecallResult;
  remember(root: string, input: RememberInput, embedding: EmbeddingResult | null): RememberResult;
  reembedCandidates(root: string, model: string, all: boolean): ReembedCandidate[];
  replaceFactEmbeddings(root: string, embeddings: Array<{ factId: string; result: EmbeddingResult }>): number;
}

export interface LocalMemoryPorts {
  repository: LocalMemoryRepository;
  embed(text: string): Promise<EmbeddingResult>;
  embeddingModel(): string;
  embedBatchForModel(model: string, values: Array<{ factId: string; text: string }>): Promise<Array<{ factId: string; result: EmbeddingResult }>>;
}
