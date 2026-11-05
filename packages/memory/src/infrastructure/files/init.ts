import fs from "node:fs/promises";
import path from "node:path";
import type { LifecycleFileWriter } from "../../application/lifecycle/init.js";
export const lifecycleFileWriter: LifecycleFileWriter = {
  async write(file, force) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    let exists = false;
    try { await fs.access(file.path); exists = true; } catch (_err: unknown) {}
    if (exists && !force) return "skipped";
    await fs.writeFile(file.path, file.content, { encoding: "utf8", mode: file.executable ? 0o755 : 0o644 });
    if (file.executable) await fs.chmod(file.path, 0o755);
    return exists ? "updated" : "created";
  },
};
