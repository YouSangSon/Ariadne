import { extractGraphqlCompatibility } from "./graphql-signature.js";
import type { CurrentContractParse } from "../../../domain/contracts/diff/types.js";

export function parseCurrentGraphqlContract(content: string): CurrentContractParse {
  const compatibility = extractGraphqlCompatibility(content);
  if (compatibility === undefined) {
    return {
      ok: false,
      endpoints: [],
      warning: 'current GraphQL contract could not be parsed: no root operations or types found'
    };
  }
  return {
    ok: true,
    endpoints: compatibility.operations.map((operation) => ({
      endpointId: `endpoint:graphql:${operation.path}`,
      httpMethod: 'GRAPHQL',
      routePath: operation.path
    })),
    graphqlCompatibility: compatibility
  };
}