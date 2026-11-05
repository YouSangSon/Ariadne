import type { MemoryRepository } from "../../application/ports/memory-repositories.js";
import type { SearchMemoryResult } from "../../domain/model/memory.js";
import type { ProjectSourceReader } from "../ports/project-sources.js";

export type IngestProjectArtifactsInput = {
  projectRoot: string;
  projectId: string;
  repository: MemoryRepository;
};

export function ingestProjectArtifacts(
  input: IngestProjectArtifactsInput,
  reader: ProjectSourceReader,
): SearchMemoryResult[] {
  assertIngestProjectArtifactsInput(input);

  const sources = reader.collect(input.projectRoot);

  return sources.map((source) =>
    input.repository.addMemory({
      scopeType: "project",
      scopeId: input.projectId,
      source: {
        scopeType: "project",
        scopeId: input.projectId,
        sourceType: source.sourceType,
        externalId: source.sourceRef,
        title: source.title,
        uri: source.uri,
      },
      memoryType: source.memoryType,
      content: source.content,
    }),
  );
}

function assertIngestProjectArtifactsInput(
  value: unknown,
): asserts value is IngestProjectArtifactsInput {
  const candidate = assertObject(value, "ingestProjectArtifacts input");
  assertNonBlankString(candidate.projectRoot, "projectRoot");
  assertNonBlankString(candidate.projectId, "projectId");
  const repository = assertObject(candidate.repository, "repository");
  assertFunction(repository.addMemory, "repository.addMemory");
}

function assertObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertNonBlankString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertFunction(value: unknown, fieldName: string): void {
  if (typeof value !== "function") {
    throw new Error(`${fieldName} must be a function`);
  }
}
