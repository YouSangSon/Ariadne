import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mavenSyntaxDiagnostics } from '../src/infrastructure/extractors/build-system/maven.js';
import { buildUiSnapshot, renderUiHtml, startUiServer } from '../src/ui.js';
import { initProject, indexProject } from '../src/index.js';
import { databasePath } from '../src/store.js';
import { DatabaseSync } from 'node:sqlite';

test('COUNT parsing rejects a long blank argument without backtracking', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { parseReturns } from './src/domain/context/graph-query.ts';
    assert.throws(() => parseReturns('COUNT(' + ' '.repeat(20000) + ')'));
    assert.deepEqual(parseReturns('COUNT(  a.path  )'), [{variable: 'a', property: 'path', count: true}]);
  `], { cwd: new URL('../', import.meta.url), timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('Maven comment removal cannot assemble a closing project tag', () => {
  assert.equal(mavenSyntaxDiagnostics({
    absolutePath: '/repo/pom.xml', relativePath: 'pom.xml', hash: '', language: 'xml',
    content: '<project><artifactId>example</artifactId></pro<!-- ignored -->ject>',
  }).length, 1);
});

test('tsconfig alias substitution treats dollar sequences as literal filename characters', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ariadne-alias-security-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '@app/*': ['src/*'] } } }));
  await writeFile(path.join(root, 'src/$&.ts'), 'export const value = 1;');
  await writeFile(path.join(root, 'src/main.ts'), 'import { value } from "@app/$&"; export const result = value;');
  await initProject({ repoRoot: root });
  const run = await indexProject({ repoRoot: root });
  const db = new DatabaseSync(databasePath(root), { readOnly: true });
  try {
    assert.ok(db.prepare('SELECT id FROM relations WHERE index_run_id = ? AND kind = ? AND source_entity_id = ? AND target_entity_id = ?')
      .get(run.indexRunId, 'DEPENDS_ON', 'file:src/main.ts', 'file:src/$&.ts'));
  } finally { db.close(); }
});

test('UI unexpected failures hide parser details and report query stays inert in HTML', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ariadne-ui-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initProject({ repoRoot: root });
  const ui = await startUiServer({ repoRoot: root, port: 0 });
  t.after(() => ui.close());
  const bad = await fetch(new URL('/api/reports/%E0%A4%A', ui.url));
  assert.equal(bad.status, 500);
  assert.match(bad.headers.get('content-type')!, /^application\/json/);
  assert.deepEqual(await bad.json(), { error: 'Unable to complete the UI request.' });
  const payload = '</script><img src=x onerror=alert(1)>';
  const response = await fetch(new URL(`/?report=${encodeURIComponent(payload)}`, ui.url));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(!html.includes(payload));
  const snapshot = await buildUiSnapshot({ repoRoot: root });
  snapshot.selectedReportId = payload;
  snapshot.errors.push({ code: 'test', message: payload });
  const rendered = renderUiHtml(snapshot);
  assert.ok(!rendered.includes(payload));
  const embedded = /<script id="impact-data" type="application\/json">([^]*?)<\/script>/.exec(rendered);
  assert.ok(embedded);
  assert.equal(JSON.parse(embedded[1]!).selectedReportId, payload);
});
