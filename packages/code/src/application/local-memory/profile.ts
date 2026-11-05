import { DEFAULT_K_PER_PARTITION } from "../../domain/local-memory/profile.js";
import type { ProfileOptions, ProfileResult } from "../../domain/local-memory/profile.js";
import type { ProfileReader } from "./profile-ports.js";

export async function profileEntity(
  repoRoot: string,
  options: ProfileOptions,
  readProfile: ProfileReader
): Promise<ProfileResult> {
  if (!options.entity) {
    throw new Error('profileEntity requires options.entity');
  }
  const branchName = options.branch ?? 'main';
  const k = Math.max(1, Math.min(options.k ?? DEFAULT_K_PER_PARTITION, 200));

  return readProfile(repoRoot, branchName, options.entity, k, options.asOfTx);
}
