import type { ToolRegistry, WithCanonicalServices } from "../contracts/tools.js";
import { reindexCanonicalMemory } from "../indexing/canonical-indexing.js";
import type { ToolRuntime } from "../ports/tool-runtime.js";
import { assertProvidedScopeIdentifiers, requireProjectKey, requireUserScopeId } from "./tool-utils.js";

type StoreToolHandlers = Pick<ToolRegistry, "reindex_memory">;

export function createStoreToolHandlers(input: {
  runtime: ToolRuntime;
  cwd: string;
  defaultUserScopeId?: string;
  withCanonicalServices: WithCanonicalServices;
}): StoreToolHandlers {
  const { cwd, defaultUserScopeId, withCanonicalServices } = input;

  return {
    async reindex_memory(toolInput) {
      const organizationId = toolInput.organizationId?.trim();
      if (!organizationId) {
        throw new Error(
          "reindex_memory requires organizationId: omitting it would reindex chunks " +
            "across all tenants sharing the same scope, violating data isolation. " +
            "Pass the caller's organization identifier.",
        );
      }
      assertProvidedScopeIdentifiers(toolInput);
      const projectKey = requireProjectKey(toolInput.projectKey, "project");
      const userScopeId = input.runtime.resolveUserScopeId({
        cwd,
        explicitUserScopeId: toolInput.userScopeId,
        defaultUserScopeId,
      });
      const scopes = [
        {
          scopeType: "project" as const,
          scopeId: projectKey,
        },
        ...(userScopeId
          ? [
              {
                scopeType: "user" as const,
                scopeId: requireUserScopeId(userScopeId),
              },
            ]
          : []),
      ];

      const result = await withCanonicalServices((services) =>
        reindexCanonicalMemory({
          repository: services.repository,
          writes: services.writes,
          chunkRepository: services.chunkRepository,
          embeddings: services.embeddings,
          vectorIndex: services.vectorIndex,
          organizationId,
          scopes,
        }),
      );

      return {
        ok: true,
        projectKey,
        scopes: scopes.map((scope) => `${scope.scopeType}:${scope.scopeId}`),
        chunkCount: result.chunkCount,
      };
    },
  };
}
