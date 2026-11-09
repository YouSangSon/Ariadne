import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { startUiServer } from '../src/ui.js';

test('disabled source preview never inspects or opens a requested file', async (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'ariadne-disabled-preview-'));
  const file = path.join(root, 'private.txt');
  fs.writeFileSync(file, 'private source content');
  const server = await startUiServer({ repoRoot: root, port: 0 });
  let reads = 0;
  const originalLstat = fs.lstatSync;
  const originalOpen = fs.promises.open;
  t.mock.method(fs, 'lstatSync', (...args: Parameters<typeof originalLstat>) => {
    reads++;
    return originalLstat(...args);
  });
  t.mock.method(fs.promises, 'open', async (...args: Parameters<typeof originalOpen>) => {
    reads++;
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    for (const requested of ['private.txt', '../outside.txt', file, 'missing.txt', '<script>']) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(new URL(`/source?path=${encodeURIComponent(requested)}`, server.url), { method });
        assert.equal(response.status, 410);
        assert.match(response.headers.get('content-type')!, /^text\/plain/);
        assert.equal(await response.text(), 'Live source preview is disabled. Open the file in your local editor.');
      }
    }
    assert.equal(reads, 0);
  } finally {
    await server.close();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
