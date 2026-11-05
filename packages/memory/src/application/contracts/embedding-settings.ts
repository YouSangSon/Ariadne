export type EmbeddingSettings = {
  provider: "openai" | "local" | "transformers";
  model: string;
  dimensions: number;
  version: "v1";
  chunkTargetTokens: 800;
  chunkOverlapTokens: 120;
};
