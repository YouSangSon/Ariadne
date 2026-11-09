import type { ProfileResult } from "../../domain/local-memory/profile.js";

export type ProfileReader = (root: string, branch: string, entity: string, k: number, asOfTx: string | undefined) => ProfileResult;
