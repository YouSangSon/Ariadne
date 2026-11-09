export interface AbandonBranchInput {
  name: string;
}

export interface AbandonBranchResult {
  branchId: string;
  name: string;
  state: 'abandoned';
  alreadyAbandoned: boolean;
}

export interface GcBranchesOptions {
  dryRun?: boolean;
  /**
   * When set, the gc pass first auto-abandons every active non-main
   * branch whose most recent activity is older than `maxAgeDays` days.
   * "Most recent activity" is `transactions.ts` of `branches.head_tx_id`,
   * falling back to `branches.created_at` for branches that never
   * received a commit. Required to be a non-negative integer when
   * provided; no default — auto-abandon is opt-in per ADR D-017.
   */
  maxAgeDays?: number;
}

export interface RestoreBranchInput {
  name: string;
}

export interface RestoreBranchResult {
  branchId: string;
  name: string;
  state: 'active';
  unarchivedTransactions: number;
  alreadyActive: boolean;
}

export interface GcBranchSummary {
  name: string;
  branchId: string;
  archivedTransactions: number;
  /**
   * True when this branch was auto-abandoned by the same gc pass
   * (active → abandoned because of `maxAgeDays`). False when the
   * branch was already abandoned before the pass started.
   */
  autoAbandoned: boolean;
}

export interface GcBranchesResult {
  scanned: number;
  archivedTransactions: number;
  /**
   * Count of branches that were auto-abandoned in this pass.
   * Always 0 when `maxAgeDays` was not provided.
   */
  autoAbandoned: number;
  branches: GcBranchSummary[];
  dryRun: boolean;
}

export interface BranchRow {
  id: string;
  name: string;
  state: string;
}

export const PROTECTED_BRANCH = 'main';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export function assertAbandonableBranch(name: string): void {
  if (name === PROTECTED_BRANCH) throw new Error(`cannot abandon protected branch: ${PROTECTED_BRANCH}`);
}

export function validateBranchRetention(maxAgeDays: number | undefined): void {
  if (maxAgeDays !== undefined && (!Number.isInteger(maxAgeDays) || maxAgeDays < 0)) {
    throw new Error(`gcBranches: maxAgeDays must be a non-negative integer; got ${String(maxAgeDays)}`);
  }
}

export function branchGcCandidates(abandoned: BranchRow[], expired: BranchRow[]): BranchRow[] {
  const byId = new Map<string, BranchRow>();
  for (const branch of abandoned) byId.set(branch.id, branch);
  for (const branch of expired) byId.set(branch.id, branch);
  return [...byId.values()];
}

export function assertDistinctMergeBranches(target: string, source: string): void {
  if (target === source) throw new Error('cannot merge a branch into itself');
}
