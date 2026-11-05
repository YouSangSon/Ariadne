export const ASYNCAPI_COMPAT_ANALYZER_ID = 'asyncapi-compat-v0';
export const ASYNCAPI_COMPAT_SCHEMA_VERSION = 1;

export type AsyncApiCompatibilitySignature = {
  readonly schemaVersion: typeof ASYNCAPI_COMPAT_SCHEMA_VERSION;
  readonly analyzer: typeof ASYNCAPI_COMPAT_ANALYZER_ID;
  readonly contractKind: 'asyncapi';
  readonly operations: readonly AsyncApiOperationSignature[];
  readonly messages: readonly AsyncApiMessageSignature[];
};

export type AsyncApiOperationSignature = {
  readonly action: string;
  readonly channelId: string;
  readonly address: string;
  readonly messageIds: readonly string[];
};

export type AsyncApiMessageSignature = {
  readonly id: string;
  readonly payload?: AsyncApiObjectSchemaSignature;
};

export type AsyncApiObjectSchemaSignature = {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, AsyncApiPropertySignature>>;
};

export type AsyncApiPropertySignature = {
  readonly type: string;
};

export type AsyncApiYamlCompatibilityParse =
  | {
    readonly ok: true;
    readonly compatibility?: AsyncApiCompatibilitySignature;
  }
  | {
    readonly ok: false;
    readonly warning: string;
  };

export type AsyncApiJsonCompatibilityParse =
  | {
    readonly ok: true;
    readonly compatibility?: AsyncApiCompatibilitySignature;
  }
  | {
    readonly ok: false;
    readonly warning: string;
  };