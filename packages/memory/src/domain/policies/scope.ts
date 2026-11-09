import type { ScopeRef } from "../model/memory.js";
import { assertNonBlankText } from "./memory-content.js";
export function normalizeScopeRefs(value: unknown, fieldName: string): ScopeRef[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return value.map((scope, index) => {
    const candidate = assertObject(scope, `${fieldName}[${index}]`);
    assertScopeType(candidate.scopeType, `${fieldName}[${index}].scopeType`);
    assertNonBlankText(candidate.scopeId, `${fieldName}[${index}].scopeId`);
    return {
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId.trim(),
    };
  });
}

function assertScopeType(value: unknown, fieldName: string): asserts value is ScopeRef["scopeType"] {
  if (value !== "project" && value !== "user") throw new Error(`${fieldName} must be "project" or "user"`);
}
function assertObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}
