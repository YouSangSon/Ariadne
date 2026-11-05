import { endpointKey } from "../../../domain/contracts/diff/shared.js";
import type { CurrentContractParse } from "../../../domain/contracts/diff/types.js";
import type { AsyncApiCompatibilitySignature } from "../../../domain/contracts/formats/asyncapi.js";
import { parseAsyncApiJsonCompatibility } from "./asyncapi-signature.js";
import { parseAsyncApiYamlCompatibility } from "./asyncapi.js";

export function parseCurrentAsyncApiContract(content: string, contractPath: string): CurrentContractParse {
  let compatibility: AsyncApiCompatibilitySignature | undefined;
  if (contractPath.toLowerCase().endsWith('.json')) {
    const parsed = parseAsyncApiJsonCompatibility(content);
    if (!parsed.ok) {
      return {
        ok: false,
        endpoints: [],
        warning: parsed.warning
      };
    }
    compatibility = parsed.compatibility;
  } else {
    const parsed = parseAsyncApiYamlCompatibility(content);
    if (!parsed.ok) {
      return {
        ok: false,
        endpoints: [],
        warning: parsed.warning
      };
    }
    compatibility = parsed.compatibility;
  }
  if (compatibility === undefined) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current AsyncAPI contract could not be parsed: no operations or messages found'
    };
  }
  return {
    ok: true,
    endpoints: compatibility.operations.map((operation) => ({
      endpointId: `endpoint:asyncapi:${endpointKey(operation.action, operation.address)}`,
      httpMethod: operation.action.toUpperCase(),
      routePath: operation.address
    })),
    asyncApiCompatibility: compatibility
  };
}