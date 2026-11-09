import { extractProtobufCompatibility } from "./protobuf-signature.js";
import type { CurrentContractParse } from "../../../domain/contracts/diff/types.js";

export function parseCurrentProtobufContract(content: string): CurrentContractParse {
  const compatibility = extractProtobufCompatibility(content);
  if (compatibility === undefined) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current Protobuf contract could not be parsed: no services or messages found'
    };
  }
  return {
    ok: true,
    endpoints: compatibility.operations.map((operation) => ({
      endpointId: `endpoint:protobuf:${operation.service}.${operation.rpc}`,
      httpMethod: 'RPC',
      routePath: operation.path
    })),
    protobufCompatibility: compatibility
  };
}