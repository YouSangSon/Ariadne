import type { OpenApiObjectSchemaSignature } from "./openapi.js";

export const JSON_SCHEMA_COMPAT_ANALYZER_ID = 'json-schema-compat-v0';
export const JSON_SCHEMA_COMPAT_SCHEMA_VERSION = 1;
export const JSON_SCHEMA_CONTRACT_KIND = 'json-schema';
export const JSON_SCHEMA_SYNTHETIC_METHOD = 'SCHEMA';
export const JSON_SCHEMA_ROOT_PATH = '#';

export type JsonSchemaCompatibilitySignature = {
  readonly schemaVersion: typeof JSON_SCHEMA_COMPAT_SCHEMA_VERSION;
  readonly analyzer: typeof JSON_SCHEMA_COMPAT_ANALYZER_ID;
  readonly contractKind: typeof JSON_SCHEMA_CONTRACT_KIND;
  readonly schemas: readonly JsonSchemaSignature[];
};

export type JsonSchemaSignature = {
  readonly id?: string;
  readonly path: typeof JSON_SCHEMA_ROOT_PATH;
  readonly body: OpenApiObjectSchemaSignature;
};