import type { OpenApiObjectSchemaSignature } from "./openapi.js";

export const AVRO_COMPAT_ANALYZER_ID = 'avro-compat-v0';
export const AVRO_COMPAT_SCHEMA_VERSION = 1;
export const AVRO_CONTRACT_KIND = 'avro';
export const AVRO_SYNTHETIC_METHOD = 'AVRO';
export const AVRO_ROOT_PATH = '#';

export type AvroCompatibilitySignature = {
  readonly schemaVersion: typeof AVRO_COMPAT_SCHEMA_VERSION;
  readonly analyzer: typeof AVRO_COMPAT_ANALYZER_ID;
  readonly contractKind: typeof AVRO_CONTRACT_KIND;
  readonly schemas: readonly AvroSchemaSignature[];
};

export type AvroSchemaSignature = {
  readonly id?: string;
  readonly path: typeof AVRO_ROOT_PATH;
  readonly body: OpenApiObjectSchemaSignature;
};