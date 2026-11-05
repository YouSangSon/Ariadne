import { createRepositoryAccess as create } from "../application/tools/tool-repository-access.js";
import { toolRuntime } from "../composition/runtime/tool-runtime.js";
export function createRepositoryAccess(input: Omit<Parameters<typeof create>[0], "runtime">) {
  return create({ ...input, runtime: toolRuntime });
}
