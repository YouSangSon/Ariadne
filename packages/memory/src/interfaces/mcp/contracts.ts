import type { CreateToolRegistryOptions, MaybePromise, ToolRegistry } from "../../application/contracts/tools.js";
import type { ScopeType } from "../../domain/model/memory.js";
import type { ToolName } from "./tool-schemas.js";


export type WorkspaceRootView = {
  uri: string;
  name?: string;
};

export type ListWorkspaceRootsToolInput = {
  organizationId?: string;
};

export type ListWorkspaceRootsToolResult = {
  ok: true;
  supported: boolean;
  roots: WorkspaceRootView[];
  message?: string;
};

export type AddMemoryInteractiveToolInput = {
  organizationId?: string;
  projectKey?: string;
  scope?: ScopeType;
  userScopeId?: string;
  kind?: string;
  message?: string;
};

export type AddMemoryInteractiveToolResult = {
  ok: true;
  action: "accept" | "decline" | "cancel" | "unsupported";
  stored: boolean;
  memoryId?: string;
  summary?: string;
  collected?: {
    projectKey?: string;
    kind?: string;
    content?: string;
  };
  message?: string;
};

export type ClassifyMemoryCandidateToolInput = {
  organizationId?: string;
  content: string;
  instruction?: string;
  maxTokens?: number;
};

export type MemoryClassificationView = {
  kind: string;
  summary: string;
  confidence?: number;
};

export type ClassifyMemoryCandidateToolResult = {
  ok: true;
  supported: boolean;
  classification?: MemoryClassificationView;
  model?: string;
  rawText?: string;
  message?: string;
};

export type McpToolAuthorizationInput = {
  toolName: ToolName;
  input: Record<string, unknown>;
};

export type McpToolAuthorizer = (
  input: McpToolAuthorizationInput,
) => MaybePromise<void>;

export type CreateMcpServerOptions = CreateToolRegistryOptions & {
  registry?: ToolRegistry;
  authorizeTool?: McpToolAuthorizer;
};
