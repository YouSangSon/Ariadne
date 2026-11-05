

export { OPENAPI_COMPAT_ANALYZER_ID, OPENAPI_COMPAT_SCHEMA_VERSION } from "./domain/contracts/formats/openapi.js";
export { objectSchemaSignature } from "./infrastructure/extractors/contracts/openapi-signature.js";
export type { OpenApiCompatibilityOperation,OpenApiCompatibilitySignature,OpenApiObjectSchemaSignature,OpenApiPropertySignature,OpenApiResponseSignature,OpenApiYamlCompatibilityParse } from "./domain/contracts/formats/openapi.js";
export { extractOpenApiJsonCompatibility,extractOpenApiYamlCompatibility,parseOpenApiYamlCompatibility } from "./infrastructure/extractors/contracts/openapi.js";
