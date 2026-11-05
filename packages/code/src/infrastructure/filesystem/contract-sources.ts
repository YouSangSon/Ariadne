import { readFileSync } from "node:fs";
import { sha256 } from "../../domain/contracts/contract-diff.js";
import { errorMessage } from "../../domain/contracts/diff/shared.js";
import type { CurrentContractParse } from "../../domain/contracts/diff/types.js";
import { parseCurrentContractByKind } from "../extractors/contracts/parse-current.js";
import { resolveInsideRoot } from "./security.js";

export function readCurrentContract(
  providerRepoPath: string,
  contractPath: string,
  contractKind: string,
  warnings: string[]
): CurrentContractParse & { contentHash?: string } {
  let absolutePath: string;
  try {
    absolutePath = resolveInsideRoot(providerRepoPath, contractPath);
  } catch (error) {
    warnings.push(`contract file skipped: ${contractPath}: ${errorMessage(error)}`);
    return {
      ok: false,
      endpoints: [],
      warning: 'current contract file could not be read'
    };
  }

  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    warnings.push(`contract file skipped: ${contractPath}: ${errorMessage(error)}`);
    return {
      ok: false,
      endpoints: [],
      warning: 'current contract file could not be read'
    };
  }

  const parsed = parseCurrentContractByKind(content, contractPath, contractKind);
  if (!parsed.ok && parsed.warning) {
    warnings.push(parsed.warning);
  }
  return {
    ...parsed,
    contentHash: sha256(content)
  };
}