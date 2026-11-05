export const OPENAPI_COMPAT_ANALYZER_ID = 'openapi-compat-v0';
export const OPENAPI_COMPAT_SCHEMA_VERSION = 5;

export type OpenApiCompatibilitySignature = {
  readonly schemaVersion: typeof OPENAPI_COMPAT_SCHEMA_VERSION;
  readonly analyzer: typeof OPENAPI_COMPAT_ANALYZER_ID;
  readonly operations: readonly OpenApiCompatibilityOperation[];
};

export type OpenApiCompatibilityOperation = {
  readonly method: string;
  readonly path: string;
  readonly requestBody?: OpenApiObjectSchemaSignature;
  readonly responses: readonly OpenApiResponseSignature[];
};

export type OpenApiResponseSignature = {
  readonly status: string;
  readonly body?: OpenApiObjectSchemaSignature;
};

export type OpenApiObjectSchemaSignature = {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, OpenApiPropertySignature>>;
};

export type OpenApiPropertySignature = {
  readonly type: string;
  readonly format?: string;
  readonly nullable?: true;
  readonly enumValues?: readonly string[];
};

export type OpenApiYamlCompatibilityParse =
  | {
    readonly ok: true;
    readonly compatibility?: OpenApiCompatibilitySignature;
  }
  | {
    readonly ok: false;
    readonly warning: string;
  };