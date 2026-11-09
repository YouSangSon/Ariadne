export type GitSnapshot = {
  commitSha: string | null;
  branchName: string | null;
  isDirty: boolean;
};