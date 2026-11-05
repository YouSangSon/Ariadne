import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolRegistry } from "../../../application/contracts/tools.js";
import type { Logger } from "../../../infrastructure/observability/logger.js";
import type { BearerToken } from "../middleware/bearer-auth.js";
import type { OAuthProtectedResourceConfig } from "../oauth-protected-resource.js";

export type RouteContext = {
  registry: ToolRegistry;
  logger: Logger;
  oauthProtectedResource?: OAuthProtectedResourceConfig | null;
};

export type Route = {
  method: "GET" | "POST";
  path: string;
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    auth?: BearerToken | null,
  ): Promise<void>;
};
