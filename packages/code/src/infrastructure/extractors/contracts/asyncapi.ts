import { parse as parseYaml } from "yaml";
import type { AsyncApiCompatibilitySignature, AsyncApiYamlCompatibilityParse } from "../../../domain/contracts/formats/asyncapi.js";
import { errorMessage, extractAsyncApiCompatibilityResult } from "./asyncapi-signature.js";

export function extractAsyncApiYamlCompatibility(content: string): AsyncApiCompatibilitySignature | undefined {
  const result = parseAsyncApiYamlCompatibility(content);
  return result.ok ? result.compatibility : undefined;
}

export function parseAsyncApiYamlCompatibility(content: string): AsyncApiYamlCompatibilityParse {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    return {
      ok: false,
      warning: `current AsyncAPI YAML could not be parsed: ${errorMessage(error)}`
    };
  }
  const result = extractAsyncApiCompatibilityResult(parsed);
  if (result.kind === 'invalid') {
    return {
      ok: false,
      warning: `current AsyncAPI YAML could not be parsed: ${result.reason}`
    };
  }
  return {
    ok: true,
    ...(result.kind === 'compatible' ? { compatibility: result.compatibility } : {})
  };
}