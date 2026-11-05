import type { AnalyzeContractDiffOptions, ContractProviderBaseline, ImpactedContractConsumer } from "../../domain/contracts/contract-diff.js";
import type { ContractDiffChange, ContractEndpoint, CurrentContractParse } from "../../domain/contracts/diff/types.js";
import type { WorkspaceSummary } from "../../domain/workspace/catalog.js";

export interface ContractProviderSession {
  baseline: ContractProviderBaseline;
  previousEndpoints(): ContractEndpoint[];
  close(): void;
}
export interface ContractDiffPorts {
  normalizeRoot(root: string): string;
  workspace(root: string, name?: string): WorkspaceSummary;
  openProvider(workspace: WorkspaceSummary, options: AnalyzeContractDiffOptions, path: string, warnings: string[]): ContractProviderSession;
  currentContract(root: string, path: string, kind: string, warnings: string[]): CurrentContractParse & { contentHash?: string };
  projectImpacts(root: string, workspace: string, provider: ContractProviderBaseline, path: string, changes: ContractDiffChange[], options: { readOnly: boolean; persist: boolean }): ImpactedContractConsumer[];
}
