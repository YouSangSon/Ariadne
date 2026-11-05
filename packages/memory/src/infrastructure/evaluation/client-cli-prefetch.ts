import path from "node:path";
import { type ClientAbExperiment, type ClientAbPreflight, type ClientExecutor, type ClientPrefetchPack, type PreparedClientTask } from "../../application/evaluation/client-policy.js";
import { prefetchContextPack } from "../../application/evaluation/prefetch-context-pack.js";
import type { PgQueryable } from "../postgres/connection.js";
import { runClientCommand } from "./client-ab.js";

export async function prefetchCliContextPack(input: {
  experiment: ClientAbExperiment; task: PreparedClientTask; preflight: ClientAbPreflight;
  repoDir: string; env: NodeJS.ProcessEnv; database: PgQueryable; execute?: ClientExecutor;
}): Promise<ClientPrefetchPack> {
  const env: NodeJS.ProcessEnv = { DMO_CWD: input.repoDir, NO_COLOR: "1" };
  for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "DATABASE_URL", "QDRANT_URL", "QDRANT_API_KEY", "QDRANT_COLLECTION_NAME", "VECTOR_BACKEND", "EMBEDDING_PROVIDER", "EMBEDDING_DIMENSIONS", "EMBEDDING_MODEL", "TRANSFORMERS_EMBEDDING_MODEL"]) {
    if (input.env[name] !== undefined) env[name] = input.env[name];
  }
  return prefetchContextPack({ ...input,
    receipts: {
      async cursor() {
        const before = await input.database.query<{ cursor: string }>("SELECT COALESCE(MAX(id), 0)::text AS cursor FROM context_pack_runs");
        return before.rows[0]?.cursor as string;
      },
      async since(cursor, scope) {
        const after = await input.database.query<{ id: string; selected_memory_ids: string[]; pack_markdown: string }>(
          "SELECT id::text, selected_memory_ids, pack_markdown FROM context_pack_runs WHERE id > $1::bigint AND organization_id = $2 AND project_key = $3 AND task = $4 ORDER BY id LIMIT 2",
          [cursor, scope.organizationId, scope.projectKey, scope.task],
        );
        return after.rows.map((row) => ({ id: row.id, selectedMemoryIds: row.selected_memory_ids, packMarkdown: row.pack_markdown }));
      },
    },
    command: {
      async execute() {
        const started = performance.now();
        const output = await (input.execute ?? runClientCommand)({
          binary: process.execPath,
          args: [path.join(input.repoDir, "dist/src/cli.js"), "pack", "--project", input.experiment.projectKey, "--task", input.task.task, "--user", input.experiment.userScopeId, "--organization-id", input.experiment.organizationId],
          env, cwd: input.repoDir, stdin: "", finalOutputPath: "",
        });
        return { stdout: output.stdout, durationMs: performance.now() - started };
      },
    },
  });
}
