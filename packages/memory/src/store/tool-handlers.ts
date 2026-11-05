import { createStoreToolHandlers as create } from "../application/tools/store-handlers.js";
import { toolRuntime } from "../composition/runtime/tool-runtime.js";
export function createStoreToolHandlers(input: Omit<Parameters<typeof create>[0], "runtime">) {
  return create({ ...input, runtime: toolRuntime });
}
