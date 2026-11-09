import { writeFileSync } from "node:fs";
import path from "node:path";
import { databasePath, ensureImpactDir, ensureRepo, openDatabase } from "../sqlite/store.js";

export function initializeConfig(root: string, content: string) {
  const configPath = path.join(ensureImpactDir(root), 'config.json');
  try { writeFileSync(configPath, content, { encoding: 'utf8', flag: 'wx' }); return { created: true, configPath }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return { created: false, configPath }; }
}
export function initializeStore(root: string): string {
  const db = openDatabase(root);
  try { ensureRepo(db, root); } finally { db.close(); }
  return databasePath(root);
}
