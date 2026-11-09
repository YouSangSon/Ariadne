import { isAsyncApiContractPath } from "../../../domain/contracts/contract-diff.js";
import { parseCurrentAvroContract } from "./avro-diff.js";
import { parseCurrentGraphqlContract } from "./graphql-diff.js";
import { parseCurrentJsonSchemaContract } from "./json-schema-diff.js";
import { parseCurrentProtobufContract } from "./protobuf-diff.js";
import type { CurrentContractParse } from "../../../domain/contracts/diff/types.js";
import { parseCurrentAsyncApiContract } from "./asyncapi-diff.js";
import { parseCurrentOpenApiContract } from "./openapi-diff.js";

export function parseCurrentContractByKind(content: string, contractPath: string, contractKind: string): CurrentContractParse {
  const lowerPath = contractPath.toLowerCase();
  if (contractKind === 'protobuf' || lowerPath.endsWith('.proto')) return parseCurrentProtobufContract(content);
  if (contractKind === 'graphql' || lowerPath.endsWith('.graphql') || lowerPath.endsWith('.gql')) {
    return parseCurrentGraphqlContract(content);
  }
  if (contractKind === 'asyncapi' || isAsyncApiContractPath(contractPath)) return parseCurrentAsyncApiContract(content, contractPath);
  if (contractKind === 'json-schema') return parseCurrentJsonSchemaContract(content);
  if (contractKind === 'avro' || lowerPath.endsWith('.avsc')) return parseCurrentAvroContract(content);
  return parseCurrentOpenApiContract(content, contractPath);
}