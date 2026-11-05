export const PROTOBUF_COMPAT_ANALYZER_ID = 'protobuf-compat-v0';
export const PROTOBUF_COMPAT_SCHEMA_VERSION = 1;

export type ProtobufCompatibilitySignature = {
  readonly schemaVersion: typeof PROTOBUF_COMPAT_SCHEMA_VERSION;
  readonly analyzer: typeof PROTOBUF_COMPAT_ANALYZER_ID;
  readonly contractKind: 'protobuf';
  readonly package?: string;
  readonly operations: readonly ProtobufOperationSignature[];
  readonly messages: readonly ProtobufMessageSignature[];
};

export type ProtobufOperationSignature = {
  readonly service: string;
  readonly rpc: string;
  readonly path: string;
  readonly requestType: string;
  readonly responseType: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
};

export type ProtobufMessageSignature = {
  readonly name: string;
  readonly fields: readonly ProtobufFieldSignature[];
};

export type ProtobufFieldSignature = {
  readonly number: number;
  readonly name: string;
  readonly type: string;
  readonly label: 'singular' | 'optional' | 'required' | 'repeated';
};