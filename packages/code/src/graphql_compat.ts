

export { GRAPHQL_COMPAT_ANALYZER_ID, GRAPHQL_COMPAT_SCHEMA_VERSION } from "./domain/contracts/formats/graphql.js";
export { extractGraphqlCompatibility, stripGraphqlComments } from "./infrastructure/extractors/contracts/graphql-signature.js";
export type { GraphqlArgumentSignature,GraphqlCompatibilitySignature,GraphqlFieldSignature,GraphqlInputFieldSignature,GraphqlInputTypeSignature,GraphqlObjectTypeSignature,GraphqlOperationSignature } from "./domain/contracts/formats/graphql.js";
