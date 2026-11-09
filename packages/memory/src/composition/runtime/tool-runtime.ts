import type { ToolRuntime } from "../../application/ports/tool-runtime.js";
import { resolveUserScopeId } from "../../infrastructure/identity/user-scope.js";
import { rootLogger } from "../../infrastructure/observability/logger.js";
export const toolRuntime: ToolRuntime = {
  logger: rootLogger,
  resolveUserScopeId,
  allowLegacyAnonymous: () => process.env.LEGACY_ANONYMOUS_SEARCH === "true",
};
