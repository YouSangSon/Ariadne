import type { McpContext } from "../application/context/request.js";
import type { ContextSearchPorts } from "../application/context/search-ports.js";
import { searchContextForRepo as forRepo, searchContext as search, searchContextSemanticEmbedding as semantic } from "../application/context/search.js";
import type { SearchContextForRepoOptions, SearchContextOptions } from "../domain/context/search.js";
import { normalizeRepoRoot } from "../infrastructure/filesystem/security.js";
import { computeEmbedding, selectedEmbeddingModel } from "../infrastructure/models/embeddings.js";
import { hasSearchEmbeddings, openSearchSession } from "../infrastructure/sqlite/context-search.js";

export const contextSearchPorts: ContextSearchPorts = {
  normalizeRoot: normalizeRepoRoot,
  embeddingModel: selectedEmbeddingModel,
  hasEmbeddings: hasSearchEmbeddings,
  embed: computeEmbedding,
  openSession: openSearchSession
};
export function searchContext(context: McpContext, options: SearchContextOptions) {
  return search(context, options, contextSearchPorts);
}
export function searchContextForRepo(options: SearchContextForRepoOptions) {
  return forRepo(options, contextSearchPorts);
}
export function searchContextSemanticEmbedding(context: McpContext, query: string) {
  return semantic(context, query, contextSearchPorts);
}
export type { SearchContextForRepoOptions } from '../domain/context/search.js';
