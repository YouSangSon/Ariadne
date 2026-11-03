import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { startUiServer } from '../src/ui.js';

for (const attack of ['leaf', 'ancestor', 'ancestor-toggle', 'growth'] as const) {
  test(`source preview rejects ${attack} replacement after path validation`, async (t) => {
    const dir = fs.realpathSync(fs.mkdtempSync('/tmp/ariadne-ui-race-'));
    const repoRoot = path.join(dir, 'repo');
    const sourceDir = path.join(repoRoot, 'src');
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(outside);
    const file = path.join(sourceDir, 'file.ts');
    fs.writeFileSync(file, 'allowed source');
    fs.writeFileSync(path.join(outside, 'file.ts'), 'outside confidential content');
    let changed = false;
    let openedOutside = false;
    const change = () => {
      if (changed) return;
      changed = true;
      if (attack === 'leaf') {
        fs.unlinkSync(file);
        fs.symlinkSync(path.join(outside, 'file.ts'), file);
      } else if (attack === 'ancestor' || attack === 'ancestor-toggle') {
        fs.renameSync(sourceDir, `${sourceDir}.original`);
        fs.symlinkSync(outside, sourceDir);
      } else fs.writeFileSync(file, 'x'.repeat(1_000_001));
    };
    const restoreAncestor = () => {
      fs.unlinkSync(sourceDir);
      fs.renameSync(`${sourceDir}.original`, sourceDir);
    };
    const originalStat = fs.promises.stat;
    const originalOpen = fs.promises.open;
    t.mock.method(fs.promises, 'stat', async (...args: Parameters<typeof originalStat>) => {
      if (String(args[0]) === file && attack === 'ancestor-toggle' && openedOutside) {
        changed = false;
        change();
        try { return await originalStat(...args); }
        finally { restoreAncestor(); }
      }
      const result = await originalStat(...args);
      if (String(args[0]) === file) change();
      return result;
    });
    t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof originalOpen>) => {
      if (String(args[0]) === file && attack !== 'growth') change();
      const handle = await originalOpen(...args);
      if (String(args[0]) === file && attack === 'ancestor-toggle') {
        openedOutside = true;
        restoreAncestor();
      }
      if (String(args[0]) === file && attack === 'growth') {
        const stat = handle.stat.bind(handle);
        t.mock.method(handle, 'stat', async (...options: Parameters<typeof stat>) => {
          const result = await stat(...options);
          change();
          return result;
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    const server = await startUiServer({ repoRoot, port: 0 });
    try {
      const result = await fetch(new URL('/source?path=src/file.ts', server.url));
      const body = await result.text();
      assert.equal(changed, true);
      assert.equal(result.status, 400);
      assert.ok(!body.includes('outside confidential content'));
    } finally {
      await server.close();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true });
    }
  });
}
