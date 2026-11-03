import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { PACKAGE_NAME } from './branding.js';
import { normalizeRepoRoot } from './security.js';
import { databasePath, ensureImpactDir, ensureRepo, openDatabase } from './store.js';
import type { InitOptions, InitResult } from './types.js';

export async function initProject(options: InitOptions): Promise<InitResult> {
  const repoRoot = normalizeRepoRoot(options.repoRoot);
  const dir = ensureImpactDir(repoRoot);
  const configPath = path.join(dir, 'config.json');
  let created = true;
  try {
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          schemaVersion: 3,
          project: PACKAGE_NAME,
          mcp: { readOnly: true },
          redaction: { enabled: true }
        },
        null,
        2
      )}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    created = false;
  }
  const db = openDatabase(repoRoot);
  try {
    ensureRepo(db, repoRoot);
  } finally {
    db.close();
  }
  return { created, configPath, databasePath: databasePath(repoRoot) };
}
