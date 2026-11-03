import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createBranch, importSession, initProject, recallOnRepo, withAgentMemoryDb } from '../src/index.js';
import { databasePath } from '../src/store.js';

process.env.PARALLAX_EMBEDDING_MODEL = 'stub-sha256';

const require = createRequire(import.meta.url);
const tsxLoaderPath = require.resolve('tsx');

async function makeRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'parallax-session-'));
  await mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'docs'), { recursive: true });
  await mkdir(path.join(repoRoot, 'sessions'), { recursive: true });
  await writeFile(path.join(repoRoot, 'src/a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(repoRoot, 'docs/policy.md'), '# Policy\nUse src/a.ts for examples.\n');
  await initProject({ repoRoot });
  return repoRoot;
}

test('importSession stores a redacted session summary and referenced file facts', async () => {
  const repoRoot = await makeRepo();
  await writeFile(
    path.join(repoRoot, 'sessions/codex.jsonl'),
    [
      JSON.stringify({
        role: 'user',
        content: 'Please update src/a.ts and docs/policy.md using sk-12345678901234567890'
      }),
      JSON.stringify({
        type: 'tool_use',
        name: 'apply_patch',
        input: { path: 'src/a.ts', patch: 'raw patch content that should not be persisted' }
      })
    ].join('\n')
  );

  const result = await importSession({
    repoRoot,
    file: 'sessions/codex.jsonl',
    format: 'codex'
  });

  assert.equal(result.format, 'codex');
  assert.equal(result.source.kind, 'repo');
  assert.equal(result.source.path, 'sessions/codex.jsonl');
  assert.deepEqual(result.referencedFiles, ['docs/policy.md', 'src/a.ts']);
  assert.equal(result.referenceFactIds.length, 2);

  const summary = await recallOnRepo(repoRoot, {
    entity: result.sessionEntityId,
    attribute: 'session_summary',
    k: 1
  });
  assert.equal(summary.facts.length, 1);
  const value = summary.facts[0]!.value as {
    summary: string;
    referencedFiles: string[];
    redactedSample: string;
  };
  assert.match(value.summary, /Imported codex session/);
  assert.deepEqual(value.referencedFiles, ['docs/policy.md', 'src/a.ts']);
  assert.doesNotMatch(JSON.stringify(value), /sk-12345678901234567890/);
  assert.doesNotMatch(JSON.stringify(value), /raw patch content/);

  const refs = await recallOnRepo(repoRoot, {
    entity: result.sessionEntityId,
    attribute: 'references_file',
    k: 10
  });
  assert.deepEqual(
    refs.facts.map((fact) => fact.value).sort(),
    ['file:docs/policy.md', 'file:src/a.ts']
  );

  const db = new DatabaseSync(databasePath(repoRoot), { readOnly: true });
  try {
    for (const referenceFactId of result.referenceFactIds) {
      const row = db
        .prepare('SELECT source_fact_id AS sourceFactId FROM fact_provenance WHERE fact_id = ?')
        .get(referenceFactId) as { sourceFactId: string } | undefined;
      assert.equal(row?.sourceFactId, result.summaryFactId);
    }
    const values = db.prepare("SELECT group_concat(value_blob, char(10)) AS text FROM facts").get() as { text: string };
    assert.doesNotMatch(values.text, /sk-12345678901234567890/);
    assert.doesNotMatch(values.text, /raw patch content/);
  } finally {
    db.close();
  }
});

test('importSession handles plain text sessions, ignores outside refs, and is idempotent', async () => {
  const repoRoot = await makeRepo();
  await writeFile(
    path.join(repoRoot, 'sessions/plain.txt'),
    [
      'Touched README.md but it does not exist in this fixture.',
      'Changed src/a.ts.',
      'Ignored ../outside.ts and /tmp/outside.ts.'
    ].join('\n')
  );

  const first = await importSession({
    repoRoot,
    file: 'sessions/plain.txt',
    format: 'codex'
  });
  const db = new DatabaseSync(databasePath(repoRoot), { readOnly: true });
  let headAfterFirst: string | null;
  try {
    headAfterFirst = (db.prepare("SELECT head_tx_id FROM branches WHERE name = 'main'").get() as { head_tx_id: string | null }).head_tx_id;
  } finally {
    db.close();
  }

  const second = await importSession({
    repoRoot,
    file: 'sessions/plain.txt',
    format: 'codex'
  });
  const afterDb = new DatabaseSync(databasePath(repoRoot), { readOnly: true });
  try {
    const headAfterSecond = (afterDb.prepare("SELECT head_tx_id FROM branches WHERE name = 'main'").get() as { head_tx_id: string | null }).head_tx_id;
    assert.equal(headAfterSecond, headAfterFirst);
  } finally {
    afterDb.close();
  }

  assert.deepEqual(first.referencedFiles, ['src/a.ts']);
  assert.equal(second.summaryFactId, first.summaryFactId);
  assert.deepEqual(second.referenceFactIds, first.referenceFactIds);
  assert.equal(second.factsWritten, 0);
});

test('importSession idempotency is scoped to the requested branch visibility', async () => {
  const repoRoot = await makeRepo();
  await writeFile(path.join(repoRoot, 'sessions/branch.jsonl'), JSON.stringify({ content: 'Changed src/a.ts' }));
  withAgentMemoryDb(repoRoot, false, (db) => createBranch(db, { name: 'feature' }));

  const mainImport = await importSession({
    repoRoot,
    file: 'sessions/branch.jsonl',
    format: 'codex'
  });
  const featureImport = await importSession({
    repoRoot,
    file: 'sessions/branch.jsonl',
    format: 'codex',
    branch: 'feature'
  });
  const repeatedFeatureImport = await importSession({
    repoRoot,
    file: 'sessions/branch.jsonl',
    format: 'codex',
    branch: 'feature'
  });

  assert.equal(mainImport.sessionEntityId, featureImport.sessionEntityId);
  assert.notEqual(mainImport.summaryFactId, featureImport.summaryFactId);
  assert.equal(repeatedFeatureImport.summaryFactId, featureImport.summaryFactId);
  assert.equal(repeatedFeatureImport.factsWritten, 0);

  const recalled = await recallOnRepo(repoRoot, {
    branch: 'feature',
    entity: featureImport.sessionEntityId,
    attribute: 'session_summary',
    k: 5
  });
  assert.equal(recalled.facts.length, 1);
  assert.equal(recalled.facts[0]!.id, featureImport.summaryFactId);
});

test('importSession allows an explicitly named external file but redacts its persisted source path', async () => {
  const repoRoot = await makeRepo();
  const externalDir = await mkdtemp(path.join(tmpdir(), 'parallax-external-session-'));
  const externalFile = path.join(externalDir, 'claude.jsonl');
  await writeFile(externalFile, JSON.stringify({ message: 'Claude touched src/a.ts' }));

  const result = await importSession({
    repoRoot,
    file: externalFile,
    format: 'claude'
  });

  assert.equal(result.source.kind, 'external-explicit');
  assert.equal(result.source.path, '[external-session-log]');
  assert.deepEqual(result.referencedFiles, ['src/a.ts']);

  const summary = await recallOnRepo(repoRoot, {
    entity: result.sessionEntityId,
    attribute: 'session_summary',
    k: 1
  });
  assert.equal((summary.facts[0]!.value as { source: { path: string } }).source.path, '[external-session-log]');
  assert.doesNotMatch(JSON.stringify(summary.facts[0]!.value), new RegExp(externalDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('importSession rejects directories and missing databases without creating workspace files', async () => {
  const repoRoot = await makeRepo();
  await assert.rejects(
    importSession({ repoRoot, file: 'sessions', format: 'codex' }),
    /session file must be a regular file/
  );
  await assert.rejects(
    importSession({ repoRoot, file: 'sessions/*.jsonl', format: 'codex' }),
    /glob patterns are not supported/
  );
  await assert.rejects(
    importSession({ repoRoot, file: 'sessions/bad\0path.jsonl', format: 'codex' }),
    /invalid session file path/
  );
  await assert.rejects(
    importSession({ repoRoot, file: '../outside.jsonl', format: 'codex' }),
    /outside repo root/
  );

  const uninitializedRepo = await mkdtemp(path.join(tmpdir(), 'parallax-session-uninit-'));
  await writeFile(path.join(uninitializedRepo, 'session.jsonl'), JSON.stringify({ message: 'src/a.ts' }));
  await assert.rejects(
    importSession({ repoRoot: uninitializedRepo, file: 'session.jsonl', format: 'codex' }),
    /parallax database not found/
  );
  assert.equal(existsSync(path.join(uninitializedRepo, '.parallax')), false);
});

test('CLI import-session imports a claude transcript', async () => {
  const repoRoot = await makeRepo();
  await writeFile(path.join(repoRoot, 'sessions/claude.jsonl'), JSON.stringify({ content: 'Review docs/policy.md' }));

  const result = spawnSync(
    process.execPath,
    ['--import', tsxLoaderPath, path.resolve('src/cli.ts'), 'import-session', '--file', 'sessions/claude.jsonl', '--format', 'claude'],
    {
      cwd: repoRoot,
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as Awaited<ReturnType<typeof importSession>>;
  assert.equal(parsed.format, 'claude');
  assert.deepEqual(parsed.referencedFiles, ['docs/policy.md']);
});

test('CLI import-session handles hostile path tokens and preserves reference matching', async (t) => {
  const repoRoot = await makeRepo();
  const externalDir = await mkdtemp(path.join(tmpdir(), 'parallax-session-outside-'));
  t.after(async () => {
    await Promise.all([rm(repoRoot, { recursive: true, force: true }), rm(externalDir, { recursive: true, force: true })]);
  });
  for (const file of [
    '.config.js', 'Makefile', '.env', 'no-extension',
    'src/quoted.ts', 'src/backtick.ts', 'src/paren.ts', 'src/bracket.ts', 'src/brace.ts',
    'src/name+@_-.d.ts', 'src/dotted../file.ts', 'src/left.ts', 'src/right.ts', 'src/empty.ts',
    'node_modules/ignored.ts', 'src/node_modules/ignored.ts', '.parallax/ignored.ts', 'src/.parallax/ignored.ts'
  ]) {
    await mkdir(path.dirname(path.join(repoRoot, file)), { recursive: true });
    await writeFile(path.join(repoRoot, file), 'fixture\n');
  }
  const externalFile = path.join(externalDir, 'outside.ts');
  await writeFile(externalFile, 'outside\n');
  await symlink(externalFile, path.join(repoRoot, 'src/outside.ts'));
  await symlink(path.join(repoRoot, 'src/a.ts'), path.join(repoRoot, 'src/alias.ts'));
  await mkdir(path.join(repoRoot, 'docs/directory.md'));
  await writeFile(path.join(repoRoot, 'sessions/hostile.txt'), [
    '.config.js Makefile.. .env no-extension.',
    '"src/quoted.ts" `src/backtick.ts` (src/paren.ts) [src/bracket.ts] {src/brace.ts}',
    'src/name+@_-.d.ts src/dotted../file.ts docs/policy.md, ./src/a.ts... src/alias.ts;',
    ':src/left.ts src/right.ts! src//empty.ts docs/directory.md',
    'node_modules/ignored.ts src/node_modules/ignored.ts .parallax/ignored.ts src/.parallax/ignored.ts',
    `../outside.ts ${externalFile} src/outside.ts`,
    `${'.+/'.repeat(40)}no-extension`,
    `${'+.'.repeat(20_000)}/`,
    `a${'.'.repeat(120_000)}a.js`
  ].join('\n'));

  const result = spawnSync(
    process.execPath,
    ['--import', tsxLoaderPath, path.resolve('src/cli.ts'), 'import-session', '--file', 'sessions/hostile.txt', '--format', 'codex'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 5_000 }
  );

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const parsed = JSON.parse(result.stdout) as Awaited<ReturnType<typeof importSession>>;
  assert.deepEqual(parsed.referencedFiles, [
    '.config.js', 'Makefile', 'docs/policy.md', 'src/a.ts', 'src/backtick.ts', 'src/brace.ts',
    'src/bracket.ts', 'src/dotted../file.ts', 'src/name+@_-.d.ts', 'src/paren.ts', 'src/quoted.ts'
  ]);
  assert.equal(parsed.referenceFactIds.length, parsed.referencedFiles.length);
});

test('CLI import-session validates required file and format', async () => {
  const repoRoot = await makeRepo();

  const missingFile = spawnSync(
    process.execPath,
    ['--import', tsxLoaderPath, path.resolve('src/cli.ts'), 'import-session', '--format', 'codex'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.equal(missingFile.status, 2);
  assert.match(missingFile.stderr, /missing required --file/);

  const badFormat = spawnSync(
    process.execPath,
    ['--import', tsxLoaderPath, path.resolve('src/cli.ts'), 'import-session', '--file', 'sessions/nope.jsonl', '--format', 'cursor'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.equal(badFormat.status, 2);
  assert.match(badFormat.stderr, /format must be codex or claude/);
});
