import { JSON_SCHEMA_COMPAT_ANALYZER_ID, JSON_SCHEMA_COMPAT_SCHEMA_VERSION, JSON_SCHEMA_CONTRACT_KIND, JSON_SCHEMA_ROOT_PATH } from "../../../domain/contracts/formats/json-schema.js";
import type { JsonSchemaCompatibilitySignature } from "../../../domain/contracts/formats/json-schema.js";
import { objectSchemaSignature } from "./openapi-signature.js";

export function extractJsonSchemaCompatibility(content: string): JsonSchemaCompatibilitySignature | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const body = objectSchemaSignature(parsed, parsed, new Set());
  if (body === undefined) return undefined;
  const id = typeof parsed.$id === 'string' && parsed.$id.length > 0 ? parsed.$id : undefined;
  return {
    schemaVersion: JSON_SCHEMA_COMPAT_SCHEMA_VERSION,
    analyzer: JSON_SCHEMA_COMPAT_ANALYZER_ID,
    contractKind: JSON_SCHEMA_CONTRACT_KIND,
    schemas: [
      {
        ...(id !== undefined ? { id } : {}),
        path: JSON_SCHEMA_ROOT_PATH,
        body
      }
    ]
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}