import type { SearchMemoryResult } from "../model/memory.js";

export type CandidateSource = "vector" | "lexical" | "hybrid";

export type RetrievedMemoryCandidate = {
  record: SearchMemoryResult;
  source: CandidateSource;
  scores: {
    vector?: number;
    lexical?: number;
    scope: number;
    metadata: number;
    recency: number;
    total: number;
  };
  reasons: string[];
};
