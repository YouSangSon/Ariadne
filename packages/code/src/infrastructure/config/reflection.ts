import { DEFAULT_MAX_FACTS_PER_ENTITY, MIN_FACTS_PER_ENTITY } from "../../domain/local-memory/reflection.js";
import { envValue } from "./branding.js";

export function maxFactsPerEntity(): number {
  const raw = envValue('REFLECT_MAX_FACTS_PER_ENTITY');
  if (!raw) return DEFAULT_MAX_FACTS_PER_ENTITY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_FACTS_PER_ENTITY) {
    return DEFAULT_MAX_FACTS_PER_ENTITY;
  }
  return parsed;
}