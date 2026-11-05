export interface SummarizeInput {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ReflectionResult {
  model: string;
  summary: string;
  inputTokens?: number;
  outputTokens?: number;
}