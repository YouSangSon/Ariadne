import type { ClientAbProfile, ClientCommand, ClientCondition, ClientExecutor, ClientVendor, ClientWorkspace, CodexSubscriptionStatus, LiveMcpServer } from "./client-policy.js";
export type EvaluationCorpusSource = {
  headSha(): string;
  hasTrackedChanges(): boolean;
  readAtRevision(sha: string, sourcePath: string): string;
};
export type ClientCommandRequest = {
  vendor: ClientVendor; condition: ClientCondition; profile?: ClientAbProfile;
  workspace: ClientWorkspace; prompt: string; expectedModel: string; effort?: string;
  maxBudgetUsd?: number; mcpServer?: LiveMcpServer; executeSubscription?: boolean;
};
export type ClientEvaluationPorts = {
  executionPolicy(): { paidEvaluationEnabled: boolean; claudeCredentialsAvailable: boolean };
  reserveResultDirectory(directory: string): Promise<void>;
  saveEvidence(destination: string, value: unknown): Promise<void>;
  createWorkspace(claimKeys: readonly string[]): Promise<ClientWorkspace>;
  removeWorkspace(workspace: ClientWorkspace): Promise<void>;
  buildCommand(input: ClientCommandRequest): Promise<ClientCommand>;
  executeClient: ClientExecutor;
  readFinalOutput(command: ClientCommand): Promise<string>;
  cliVersion(binary: string): Promise<string>;
  readSubscriptionStatus(): Promise<CodexSubscriptionStatus>;
  nowMilliseconds(): number;
};
