import type { AffectedFile, CrossRepoImpact, Evidence, ImpactTarget } from "../model.js";

export type CrossRepoImpactCandidate = {
  impact: CrossRepoImpact;
  affectedFile: AffectedFile;
  affectedTarget: ImpactTarget;
  evidence: Evidence;
};

export type CrossRepoImpactLoadResult = {
  candidates: CrossRepoImpactCandidate[];
  malformedLinkCount: number;
};