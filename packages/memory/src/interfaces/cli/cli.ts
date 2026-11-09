import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CanonicalServices } from "../../application/contracts/tools.js";
import {
  assertNonBlankString,
  assertObject,
} from "../../application/tools/tool-registry-validation.js";
import { bootstrapCanonicalServices } from "../../composition/runtime/canonical-services.js";
import { writeLifecycleInit } from "../../composition/runtime/lifecycle.js";
import { createToolRegistry, type ToolRegistry } from "../mcp/server.js";
import { parseCliArgs, type ParsedCliArgs } from "./arguments.js";

export { parseCliArgs, type ParsedCliArgs } from "./arguments.js";

type RunCliOptions = {
  registry?: ToolRegistry;
  cwd?: string;
  runtimeDir?: string;
  envFile?: string;
};

export async function runCli(
  argv: string[] = process.argv.slice(2),
  options: RunCliOptions = {},
): Promise<string> {
  const parsed = parseCliArgs(argv);
  const normalizedOptions = normalizeRunCliOptions(options);
  const cwd = normalizedOptions.cwd ?? process.cwd();
  let services: Promise<CanonicalServices> | undefined;
  const operations: Promise<unknown>[] = [];
  const getRegistry = () =>
    normalizedOptions.registry ??
    createToolRegistry({
      cwd,
      withCanonicalServices: (callback) => {
        services ??= bootstrapCanonicalServices();
        const operation = services.then(callback);
        operations.push(operation);
        return operation;
      },
    });

  let commandFailed = false;
  let commandError: unknown;
  try {
    return await dispatchCli(parsed, getRegistry, cwd, normalizedOptions);
  } catch (error: unknown) {
    commandFailed = true;
    commandError = error;
    throw error;
  } finally {
    // Instrumentation starts best-effort audit writes before dispatch settles.
    await Promise.allSettled(operations);
    try {
      await services?.then((value) => value.close?.(), () => undefined);
    } catch (closeError: unknown) {
      if (commandFailed) {
        throw new AggregateError([commandError, closeError], "CLI command and cleanup failed");
      }
      throw new Error("CLI command completed, but service cleanup failed", { cause: closeError });
    }
  }
}

async function dispatchCli(
  parsed: ParsedCliArgs,
  getRegistry: () => ToolRegistry,
  cwd: string,
  options: RunCliOptions,
): Promise<string> {
  switch (parsed.command) {
    case "pack": {
      const registry = getRegistry();
      const pack = await registry.build_context_pack({
        projectKey: parsed.projectKey,
        userScopeId: parsed.userScopeId,
        organizationId: parsed.organizationId,
        task: parsed.task,
        ...(parsed.maxOutputBytes === undefined ? {} : { maxOutputBytes: parsed.maxOutputBytes }),
      });

      return pack.packMarkdown;
    }
    case "reindex": {
      const registry = getRegistry();
      const result = await registry.reindex_memory({
        projectKey: parsed.projectKey,
        userScopeId: parsed.userScopeId,
        organizationId: parsed.organizationId ?? "default",
      });

      return JSON.stringify(result, null, 2);
    }
    case "remember": {
      const registry = getRegistry();
      const content =
        parsed.content ?? (await readContentFile(parsed.contentFile!, cwd));
      const result = await registry.add_memory({
        projectKey: parsed.projectKey,
        userScopeId: parsed.userScopeId,
        organizationId: parsed.organizationId ?? "default",
        kind: parsed.kind,
        content,
      });

      return JSON.stringify(result, null, 2);
    }
    case "init": {
      const result = await writeLifecycleInit({
        repoDir: cwd,
        runtimeDir: options.runtimeDir,
        envFile: options.envFile,
        projectKey: parsed.projectKey,
        userScopeId: parsed.userScopeId,
        organizationId: parsed.organizationId ?? "default",
        task: parsed.task,
        outDir: parsed.outDir,
        force: parsed.force,
      });

      return JSON.stringify(result, null, 2);
    }
    case "backup-verify":
    case "restore-smoke":
      return JSON.stringify(parsed, null, 2);
  }
}

function normalizeRunCliOptions(options: RunCliOptions): RunCliOptions {
  const candidate = assertObject(options, "CLI options");
  const cwd = candidate.cwd;
  const registry = candidate.registry;
  for (const field of ["runtimeDir", "envFile"] as const) {
    if (candidate[field] !== undefined) assertNonBlankString(candidate[field], field);
  }

  if (cwd !== undefined) {
    assertNonBlankString(cwd, "cwd");
  }
  if (registry !== undefined) {
    assertObject(registry, "registry");
  }

  return {
    cwd,
    registry: registry as ToolRegistry | undefined,
    runtimeDir: candidate.runtimeDir as string | undefined,
    envFile: candidate.envFile as string | undefined,
  };
}

async function readContentFile(filePath: string, cwd: string): Promise<string> {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);
  const content = await fs.readFile(resolved, "utf8");
  if (content.length === 0) {
    throw new Error(`Content file is empty: ${filePath}`);
  }
  return content;
}

if (process.argv[1] && [import.meta.url, new URL(import.meta.url.endsWith(".ts") ? "../../cli.ts" : "../../cli.js", import.meta.url).href].includes(pathToFileURL(process.argv[1]).href)) {
  runCli()
    .then((output) => {
      console.log(output);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
