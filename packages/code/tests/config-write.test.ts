import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { installParallaxMcp } from '../src/agent_config.js';
import { initProject } from '../src/init.js';

test('initProject preserves a config created immediately before its write', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'config-init-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, '.parallax/config.json');
  const userConfig = '{"custom":"concurrent init"}\n';
  const write = fs.writeFileSync;
  let inserted = false;
  t.mock.method(fs, 'writeFileSync', (...args: unknown[]) => {
    if (args[0] === configPath && !inserted) {
      inserted = true;
      write(configPath, userConfig);
    }
    return Reflect.apply(write, fs, args);
  });
  syncBuiltinESMExports();
  try {
    const result = await initProject({ repoRoot: root });
    assert.equal(inserted, true);
    assert.equal(fs.readFileSync(configPath, 'utf8'), userConfig);
    assert.equal(result.created, false);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('initProject propagates config write errors other than EEXIST', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'config-init-error-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const failure = Object.assign(new Error('forced config write failure'), { code: 'EIO' });
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (...args: unknown[]) => {
    if (args[0] === path.join(root, '.parallax/config.json')) throw failure;
    return Reflect.apply(write, fs, args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(initProject({ repoRoot: root }), (error) => error === failure);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('MCP installer refuses an existing lock without changing or deleting it', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, '.mcp.json');
  const original = '{"theme":"dark"}\n';
  fs.writeFileSync(configPath, original);
  fs.writeFileSync(`${configPath}.lock`, 'another installer', { flag: 'wx' });
  assert.throws(() => installParallaxMcp(configPath), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.equal(fs.readFileSync(`${configPath}.lock`, 'utf8'), 'another installer');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.mcp.json', '.mcp.json.lock']);
});

for (const race of ['edit', 'replacement', 'creation'] as const) {
  test(`MCP installer preserves a concurrent ${race} observed before publication`, (t) => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-drift-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, '.mcp.json');
    const original = '{"theme":"dark"}\n';
    const concurrent = race === 'replacement' ? original : '{"theme":"light"}\n';
    if (race !== 'creation') fs.writeFileSync(configPath, original);
    const write = fs.writeFileSync;
    let changed = false;
    t.mock.method(fs, 'writeFileSync', (...args: unknown[]) => {
      if (!changed) {
        changed = true;
        if (race === 'replacement') {
          write(`${configPath}.replacement`, concurrent);
          fs.renameSync(`${configPath}.replacement`, configPath);
        } else {
          write(configPath, concurrent);
        }
      }
      return Reflect.apply(write, fs, args);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => installParallaxMcp(configPath), /config changed/);
      assert.equal(changed, true);
      assert.equal(fs.readFileSync(configPath, 'utf8'), concurrent);
      assert.deepEqual(fs.readdirSync(dir), ['.mcp.json']);
    } finally {
      t.mock.restoreAll(); syncBuiltinESMExports();
    }
  });
}

test('MCP installer keeps the original and cleans owned resources after a partial write', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-partial-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, '.mcp.json');
  const original = '{"theme":"dark"}\n';
  fs.writeFileSync(configPath, original);
  const write = fs.writeFileSync;
  const open = fs.openSync;
  const opened: number[] = [];
  const failure = Object.assign(new Error('forced partial write'), { code: 'EIO' });
  let destination: unknown;
  t.mock.method(fs, 'openSync', (...args: unknown[]) => {
    const fd = Reflect.apply(open, fs, args);
    opened.push(fd);
    return fd;
  });
  t.mock.method(fs, 'writeFileSync', (...args: unknown[]) => {
    destination = args[0];
    Reflect.apply(write, fs, [destination, '{"partial":']);
    throw failure;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => installParallaxMcp(configPath), (error) => error === failure);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(dir), ['.mcp.json']);
    assert.equal(typeof destination, 'number');
    for (const fd of opened) assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('MCP installer leaves a temp file it could not exclusively create untouched', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-temp-owner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, '.mcp.json');
  fs.writeFileSync(configPath, '{}\n');
  const open = fs.openSync;
  let reserved: string | undefined;
  t.mock.method(fs, 'openSync', (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].endsWith('.tmp') && args[1] === 'wx') {
      reserved = args[0];
      fs.writeFileSync(reserved, 'owned by another writer');
    }
    return Reflect.apply(open, fs, args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => installParallaxMcp(configPath), { code: 'EEXIST' });
    assert.ok(reserved);
    assert.equal(fs.readFileSync(reserved, 'utf8'), 'owned by another writer');
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{}\n');
    assert.equal(fs.existsSync(`${configPath}.lock`), false);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('MCP installer preserves existing symlinks and mode and gives new configs private mode', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-symlink-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'client.json');
  const link = path.join(dir, '.mcp.json');
  fs.writeFileSync(target, '{"theme":"dark"}\n');
  fs.chmodSync(target, 0o660);
  fs.symlinkSync('client.json', link);
  const result = installParallaxMcp(link);
  assert.equal(result.created, false);
  assert.equal(result.path, link);
  assert.equal(result.config.theme, 'dark');
  assert.equal(fs.readlinkSync(link), 'client.json');
  assert.equal(fs.statSync(target).mode & 0o777, 0o660);
  const newPath = path.join(dir, 'new.json');
  assert.equal(installParallaxMcp(newPath).created, true);
  assert.equal(fs.statSync(newPath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.mcp.json', 'client.json', 'new.json']);
});

test('MCP installers share the canonical target lock through a symlink alias', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-installers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'client.json');
  const link = path.join(dir, '.mcp.json');
  fs.writeFileSync(target, '{}\n');
  fs.symlinkSync('client.json', link);
  const write = fs.writeFileSync;
  let attempted = false;
  t.mock.method(fs, 'writeFileSync', (...args: unknown[]) => {
    if (!attempted) {
      attempted = true;
      assert.throws(() => installParallaxMcp(target, { name: 'second' }), { code: 'EEXIST' });
    }
    return Reflect.apply(write, fs, args);
  });
  syncBuiltinESMExports();
  try {
    installParallaxMcp(link, { name: 'first' });
    assert.equal(attempted, true);
    const next = installParallaxMcp(target, { name: 'second' });
    assert.deepEqual(Object.keys(next.config.mcpServers ?? {}).sort(), ['first', 'second']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.mcp.json', 'client.json']);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('MCP installer rejects a symlink retargeted before publication', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-retarget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'client.json');
  const other = path.join(dir, 'other.json');
  const link = path.join(dir, '.mcp.json');
  fs.writeFileSync(target, '{"theme":"dark"}\n');
  fs.writeFileSync(other, '{"theme":"light"}\n');
  fs.symlinkSync('client.json', link);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (...args: unknown[]) => {
    fs.unlinkSync(link);
    fs.symlinkSync('other.json', link);
    return Reflect.apply(write, fs, args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => installParallaxMcp(link), /config changed/);
    assert.equal(fs.readlinkSync(link), 'other.json');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"theme":"dark"}\n');
    assert.equal(fs.readFileSync(other, 'utf8'), '{"theme":"light"}\n');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.mcp.json', 'client.json', 'other.json']);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('MCP installer rejects malformed JSON and dangling symlinks without leaving owned files', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'config-invalid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, '.mcp.json');
  fs.writeFileSync(configPath, '{not json\n');
  assert.throws(() => installParallaxMcp(configPath), SyntaxError);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{not json\n');
  assert.deepEqual(fs.readdirSync(dir), ['.mcp.json']);
  fs.unlinkSync(configPath);
  fs.symlinkSync('absent.json', configPath);
  assert.throws(() => installParallaxMcp(configPath), { code: 'ENOENT' });
  assert.equal(fs.readlinkSync(configPath), 'absent.json');
  assert.deepEqual(fs.readdirSync(dir), ['.mcp.json']);
});
