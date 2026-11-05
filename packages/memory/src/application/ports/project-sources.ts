import type { MemoryType, SourceType } from "../../domain/model/memory.js";
export type CollectedProjectSource = {
  sourceType: SourceType;
  sourceRef: string;
  title: string;
  content: string;
  uri: string;
  memoryType: MemoryType;
};

export type ProjectSourceReader = { collect(projectRoot: string): CollectedProjectSource[] };
