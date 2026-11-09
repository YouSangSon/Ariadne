

export { PROTOBUF_COMPAT_ANALYZER_ID, PROTOBUF_COMPAT_SCHEMA_VERSION } from "./domain/contracts/formats/protobuf.js";
export { extractProtobufCompatibility, stripProtobufComments } from "./infrastructure/extractors/contracts/protobuf-signature.js";
export type { ProtobufCompatibilitySignature,ProtobufFieldSignature,ProtobufMessageSignature,ProtobufOperationSignature } from "./domain/contracts/formats/protobuf.js";
