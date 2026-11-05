export interface EmbeddingResult {
  model: string;
  vector: Buffer;
  dim: number;
}