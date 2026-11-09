export const GRAPHQL_COMPAT_ANALYZER_ID = 'graphql-compat-v0';
export const GRAPHQL_COMPAT_SCHEMA_VERSION = 1;

export type GraphqlCompatibilitySignature = {
  readonly schemaVersion: typeof GRAPHQL_COMPAT_SCHEMA_VERSION;
  readonly analyzer: typeof GRAPHQL_COMPAT_ANALYZER_ID;
  readonly contractKind: 'graphql';
  readonly operations: readonly GraphqlOperationSignature[];
  readonly objectTypes: readonly GraphqlObjectTypeSignature[];
  readonly inputTypes: readonly GraphqlInputTypeSignature[];
};

export type GraphqlOperationSignature = {
  readonly rootType: GraphqlRootType;
  readonly field: string;
  readonly path: string;
  readonly returnType: string;
  readonly args: readonly GraphqlArgumentSignature[];
};

export type GraphqlArgumentSignature = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
};

export type GraphqlObjectTypeSignature = {
  readonly name: string;
  readonly fields: readonly GraphqlFieldSignature[];
};

export type GraphqlInputTypeSignature = {
  readonly name: string;
  readonly fields: readonly GraphqlInputFieldSignature[];
};

export type GraphqlFieldSignature = {
  readonly name: string;
  readonly type: string;
};

export type GraphqlInputFieldSignature = GraphqlFieldSignature & {
  readonly required: boolean;
};


export type GraphqlRootType = 'Query' | 'Mutation' | 'Subscription';