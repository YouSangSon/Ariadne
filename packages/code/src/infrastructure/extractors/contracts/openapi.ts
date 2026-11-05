import { parse as parseYaml } from "yaml";
import type { OpenApiCompatibilitySignature, OpenApiYamlCompatibilityParse } from "../../../domain/contracts/formats/openapi.js";
import { errorMessage, extractOpenApiCompatibility } from "./openapi-signature.js";

export function extractOpenApiJsonCompatibility(content: string): OpenApiCompatibilitySignature | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  return extractOpenApiCompatibility(parsed);
}

export function extractOpenApiYamlCompatibility(content: string): OpenApiCompatibilitySignature | undefined {
  const result = parseOpenApiYamlCompatibility(content);
  return result.ok ? result.compatibility : undefined;
}

export function parseOpenApiYamlCompatibility(content: string): OpenApiYamlCompatibilityParse {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    return {
      ok: false,
      warning: `current OpenAPI YAML could not be parsed: ${errorMessage(error)}`
    };
  }
  const compatibility = extractOpenApiCompatibility(parsed);
  return {
    ok: true,
    ...(compatibility !== undefined ? { compatibility } : {})
  };
}