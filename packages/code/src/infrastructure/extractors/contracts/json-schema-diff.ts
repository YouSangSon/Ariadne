import { JSON_SCHEMA_SYNTHETIC_METHOD } from "../../../domain/contracts/formats/json-schema.js";
import type { JsonSchemaCompatibilitySignature } from "../../../domain/contracts/formats/json-schema.js";
import { extractJsonSchemaCompatibility } from "./json-schema-signature.js";
import { errorMessage } from "../../../domain/contracts/diff/shared.js";
import type { ContractEndpoint, CurrentContractParse } from "../../../domain/contracts/diff/types.js";

export function parseCurrentJsonSchemaContract(content: string): CurrentContractParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      ok: false,
      endpoints: [],
      warning: `current JSON Schema contract could not be parsed: ${errorMessage(error)}`
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current JSON Schema contract could not be parsed: expected object schema'
    };
  }
  const compatibility = extractJsonSchemaCompatibility(content);
  if (compatibility === undefined) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current JSON Schema contract could not be parsed: no object schema signature found'
    };
  }
  return {
    ok: true,
    endpoints: jsonSchemaEndpoints(compatibility),
    jsonSchemaCompatibility: compatibility
  };
}

export function jsonSchemaEndpoints(compatibility: JsonSchemaCompatibilitySignature): ContractEndpoint[] {
  return compatibility.schemas.map((schema) => ({
    endpointId: `endpoint:json-schema:${schema.path}`,
    httpMethod: JSON_SCHEMA_SYNTHETIC_METHOD,
    routePath: schema.path
  }));
}