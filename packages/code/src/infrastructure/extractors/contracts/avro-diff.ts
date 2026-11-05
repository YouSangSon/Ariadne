import { AVRO_SYNTHETIC_METHOD } from "../../../domain/contracts/formats/avro.js";
import type { AvroCompatibilitySignature } from "../../../domain/contracts/formats/avro.js";
import { extractAvroCompatibility } from "./avro-signature.js";
import { errorMessage } from "../../../domain/contracts/diff/shared.js";
import type { ContractEndpoint, CurrentContractParse } from "../../../domain/contracts/diff/types.js";

export function parseCurrentAvroContract(content: string): CurrentContractParse {
  try {
    JSON.parse(content);
  } catch (error) {
    return {
      ok: false,
      endpoints: [],
      warning: `current Avro contract could not be parsed: ${errorMessage(error)}`
    };
  }
  const compatibility = extractAvroCompatibility(content);
  if (compatibility === undefined) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current Avro contract could not be parsed: no record schema signature found'
    };
  }
  return {
    ok: true,
    endpoints: avroEndpoints(compatibility),
    avroCompatibility: compatibility
  };
}

export function avroEndpoints(compatibility: AvroCompatibilitySignature): ContractEndpoint[] {
  return compatibility.schemas.map((schema) => ({
    endpointId: `endpoint:avro:${schema.path}`,
    httpMethod: AVRO_SYNTHETIC_METHOD,
    routePath: schema.path
  }));
}