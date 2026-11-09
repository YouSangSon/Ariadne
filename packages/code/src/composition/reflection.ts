import { reflectFacts as reflect } from "../application/local-memory/reflection.js";
import type { ReflectOptions } from "../domain/local-memory/reflection.js";
import { maxFactsPerEntity } from "../infrastructure/config/reflection.js";
import { computeEmbedding } from "../infrastructure/models/embeddings.js";
import { summarize } from "../infrastructure/models/llm.js";
import { reflectionCandidates, writeReflections } from "../infrastructure/sqlite/reflection.js";

export function reflectFacts(root: string, options: ReflectOptions = {}) {
  return reflect(root, options, {
    repository: { candidates: reflectionCandidates, persist: writeReflections },
    maxFactsPerEntity,
    summarize,
    embed: computeEmbedding
  });
}

export * from '../infrastructure/sqlite/reflection.js';
