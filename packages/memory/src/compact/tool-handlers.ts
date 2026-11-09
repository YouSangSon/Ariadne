import { createCompactionToolHandlers as create } from "../application/tools/compact-handlers.js";
import { toolRuntime } from "../composition/runtime/tool-runtime.js";
export function createCompactionToolHandlers(input: Omit<Parameters<typeof create>[0], "runtime">) {
  return create({ ...input, runtime: toolRuntime });
}
