import { recallOnRepo as recallUseCase, reembedFacts as reembedUseCase, rememberOnRepo as rememberUseCase } from "../application/local-memory/operations.js";
import type { LocalMemoryPorts } from "../application/local-memory/ports.js";
import type { RecallInput, ReembedOptions, RememberInput } from "../domain/local-memory/model.js";
import { computeEmbedding, embedBatchForModel, selectedEmbeddingModel } from "../infrastructure/models/embeddings.js";
import { recall, recallSemantic, reembedCandidates, remember, replaceFactEmbeddings, withAgentMemoryDb } from "../infrastructure/sqlite/local-memory.js";

const ports: LocalMemoryPorts = {
  embed: computeEmbedding,
  embeddingModel: selectedEmbeddingModel,
  embedBatchForModel,
  repository: {
    recall: (root, input) => withAgentMemoryDb(root, true, (db) => recall(db, input)),
    recallSemantic: (root, embedding, input) => withAgentMemoryDb(root, true, (db) => recallSemantic(db, embedding, input)),
    remember: (root, input, embedding) => withAgentMemoryDb(root, false, (db) => remember(db, input, embedding)),
    reembedCandidates,
    replaceFactEmbeddings
  }
};

export function recallOnRepo(root: string, input: RecallInput) {
  return recallUseCase(root, input, ports);
}

export function rememberOnRepo(root: string, input: RememberInput) {
  return rememberUseCase(root, input, ports);
}

export function reembedFacts(root: string, options: ReembedOptions = {}) {
  return reembedUseCase(root, options, ports);
}

export * from '../infrastructure/sqlite/local-memory.js';
