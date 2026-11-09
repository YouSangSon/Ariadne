import { profileEntity as profile } from "../application/local-memory/profile.js";
import type { ProfileOptions } from "../domain/local-memory/profile.js";
import { readProfile } from "../infrastructure/sqlite/profile.js";

export function profileEntity(root: string, options: ProfileOptions) {
  return profile(root, options, readProfile);
}
export type { ProfileOptions,ProfileResult } from '../domain/local-memory/profile.js';
