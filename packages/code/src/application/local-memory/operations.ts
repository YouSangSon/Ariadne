import type { EmbeddingResult } from "../../domain/local-memory/embedding.js";
import type { RecallInput, RecallResult, ReembedOptions, ReembedResult, RememberInput, RememberResult } from "../../domain/local-memory/model.js";
import { redactSecrets } from "../../domain/security/redaction.js";
import type { LocalMemoryPorts } from "./ports.js";

export async function reembedFacts(
  repoRoot: string,
  options: ReembedOptions,
  ports: LocalMemoryPorts
): Promise<ReembedResult> {
  const targetModel =
    options.model ?? ports.embeddingModel();

  const candidates = ports.repository.reembedCandidates(repoRoot, targetModel, options.all === true);

  if (candidates.length === 0) {
    return { model: targetModel, embedded: 0, candidates: 0 };
  }

  const embeddings = await ports.embedBatchForModel(targetModel, candidates.map((candidate) => ({
    factId: candidate.id,
    text: `${candidate.entity_id}|${candidate.attribute}|${candidate.value_blob}`
  })));

  const written = ports.repository.replaceFactEmbeddings(repoRoot, embeddings);

  return { model: targetModel, embedded: written, candidates: candidates.length };
}

export async function recallOnRepo(
  repoRoot: string,
  input: RecallInput,
  ports: LocalMemoryPorts
): Promise<RecallResult> {
  if (input.semantic === true && input.query !== undefined) {
    const queryEmbedding = await ports.embed(`query: ${input.query}`);
    return ports.repository.recallSemantic(repoRoot, queryEmbedding, input);
  }
  return ports.repository.recall(repoRoot, input);
}

export async function rememberOnRepo(
  repoRoot: string,
  input: RememberInput,
  ports: LocalMemoryPorts
): Promise<RememberResult> {
  let providedEmbedding: EmbeddingResult | null = null;
  const valueStr = JSON.stringify(input.value);
  const isRedacted = redactSecrets(valueStr) !== valueStr;
  const op = input.op ?? 'assert';
  if (!isRedacted && op === 'assert') {
    providedEmbedding = await ports.embed(
      `${input.entity}|${input.attribute}|${valueStr}`
    );
  }
  return ports.repository.remember(repoRoot, input, providedEmbedding);
}
