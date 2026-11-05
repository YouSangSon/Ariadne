import type { Logger } from "./logger.js";
export type UserScopeInput = { cwd: string; explicitUserScopeId?: string; defaultUserScopeId?: string };
export type ToolRuntime = {
  logger: Logger;
  resolveUserScopeId(input: UserScopeInput): string;
  allowLegacyAnonymous(): boolean;
};
