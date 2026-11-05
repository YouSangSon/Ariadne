import type { LifecycleInitInput } from "../../application/lifecycle/init.js";
import { writeLifecycleInit as write } from "../../application/lifecycle/init.js";
import { lifecycleFileWriter } from "../../infrastructure/files/init.js";
export function writeLifecycleInit(input: LifecycleInitInput) { return write(input, lifecycleFileWriter); }
export { buildLifecycleFiles } from "../../application/lifecycle/init.js";
export type { LifecycleInitFile, LifecycleInitInput, LifecycleInitResult } from "../../application/lifecycle/init.js";
