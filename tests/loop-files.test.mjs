import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { listProjectFiles, readProjectFile, writeProjectFile } from '../modules/loop/files.mjs'

const hash = (content) => createHash('sha256').update(content).digest('hex')

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-files-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('file tools list sorted safe paths and return original-byte hashes with scrubbed reads', (t) => {
  const root = project(t)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/main.mjs'), 'export const answer = 42\n')
  const content = 'token=ghp_' + 'a'.repeat(36)
  writeFileSync(join(root, 'README.md'), content)
  assert.deepEqual(listProjectFiles(root), ['README.md', 'src/main.mjs'])
  const read = readProjectFile(root, 'README.md')
  assert.deepEqual(read, { path: 'README.md', content: 'token=[REDACTED_GITHUB_TOKEN]', sha256: hash(content) })
  assert.equal(readProjectFile(root, 'src/main.mjs').content, 'export const answer = 42\n')
})

test('containment rejects absolute, traversal, platform-ambiguous, and control-character paths', (t) => {
  const root = project(t)
  for (const path of ['', '.', '..', '../outside', '/tmp/outside', 'src/../file', './file', 'src//file', 'src/', 'C:\\outside', 'src\\file', 'bad\0name', 'bad\nname', null]) {
    assert.throws(() => readProjectFile(root, path), /path|denied/i)
    assert.throws(() => writeProjectFile(root, path, 'content', null), /path|denied/i)
  }
})

test('model file tools cannot read, list, or overwrite control and credential paths', (t) => {
  const root = project(t)
  const protectedPaths = ['.git/config', '.harness/reqs/demo.yaml', '.codex/config.toml', '.claude/settings.json', '.gemini/settings.json', '.agents/skills/tool.md', 'node_modules/dependency/index.js', '.env', '.env.local', 'src/.env.production', 'credentials.json', 'secrets.yaml', '.ssh/id_ed25519', '.npmrc', 'AGENTS.md', 'src/CLAUDE.md', 'GEMINI.md', 'src/agents.MD']
  for (const path of protectedPaths) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), 'protected')
    assert.throws(() => readProjectFile(root, path), /denied|protected/i)
    assert.throws(() => writeProjectFile(root, path, 'overwrite', hash('protected')), /denied|protected/i)
    assert.equal(readFileSync(join(root, path), 'utf8'), 'protected')
  }
  writeFileSync(join(root, 'public.txt'), 'safe')
  assert.deepEqual(listProjectFiles(root), ['public.txt'])
})

test('symlink files and ancestors are denied even when their target stays inside the root', (t) => {
  const root = project(t)
  const outside = project(t)
  writeFileSync(join(outside, 'outside.txt'), 'outside')
  mkdirSync(join(root, 'real'))
  writeFileSync(join(root, 'real/inside.txt'), 'inside')
  symlinkSync(join(outside, 'outside.txt'), join(root, 'outside.txt'))
  symlinkSync(join(root, 'real'), join(root, 'alias'))
  for (const path of ['outside.txt', 'alias/inside.txt', 'alias/new.txt']) {
    assert.throws(() => readProjectFile(root, path), /symlink|symbolic/i)
    assert.throws(() => writeProjectFile(root, path, 'changed', null), /symlink|symbolic/i)
  }
  assert.deepEqual(listProjectFiles(root), ['real/inside.txt'])
  assert.equal(readFileSync(join(outside, 'outside.txt'), 'utf8'), 'outside')
})

test('file reads and writes enforce the 1 MiB text boundary', (t) => {
  const root = project(t)
  const atLimit = 'a'.repeat(1024 * 1024)
  assert.equal(writeProjectFile(root, 'limit.txt', atLimit, null).sha256, hash(atLimit))
  assert.equal(readProjectFile(root, 'limit.txt').content.length, atLimit.length)
  assert.throws(() => writeProjectFile(root, 'limit.txt', atLimit + 'a', hash(atLimit)), /size|MiB|large/i)
  assert.equal(readFileSync(join(root, 'limit.txt'), 'utf8'), atLimit)
  writeFileSync(join(root, 'large.txt'), atLimit + 'a')
  assert.throws(() => readProjectFile(root, 'large.txt'), /size|MiB|large/i)
  writeFileSync(join(root, 'binary.txt'), Buffer.from([0, 255, 128]))
  assert.throws(() => readProjectFile(root, 'binary.txt'), /text|UTF|binary/i)
  assert.throws(() => writeProjectFile(root, 'binary.txt', 'nul\0byte', hash(Buffer.from([0, 255, 128]))), /text|binary/i)
})

test('expectedSha protects existing data and null only permits absent files', (t) => {
  const root = project(t)
  assert.deepEqual(writeProjectFile(root, 'src/new.txt', 'first', null), { path: 'src/new.txt', sha256: hash('first') })
  assert.throws(() => writeProjectFile(root, 'src/new.txt', 'lost', null), /sha|changed|mismatch/i)
  assert.throws(() => writeProjectFile(root, 'src/new.txt', 'lost', hash('stale')), /sha|changed|mismatch/i)
  assert.throws(() => writeProjectFile(root, 'absent/new.txt', 'lost', hash('missing')), /sha|changed|mismatch/i)
  assert.equal(readFileSync(join(root, 'src/new.txt'), 'utf8'), 'first')
  assert.deepEqual(writeProjectFile(root, 'src/new.txt', 'second', hash('first')), { path: 'src/new.txt', sha256: hash('second') })
  assert.deepEqual(readdirSync(root).sort(), ['src'])
  assert.deepEqual(readdirSync(join(root, 'src')), ['new.txt'])
})

test('atomic writes preserve file mode and leave no temporary sibling', (t) => {
  const root = project(t)
  writeFileSync(join(root, 'script.mjs'), 'before')
  chmodSync(join(root, 'script.mjs'), 0o751)
  writeProjectFile(root, 'script.mjs', 'after', hash('before'))
  assert.equal(statSync(join(root, 'script.mjs')).mode & 0o777, 0o751)
  assert.equal(readFileSync(join(root, 'script.mjs'), 'utf8'), 'after')
  assert.deepEqual(readdirSync(root), ['script.mjs'])
})

test('a failed rename preserves the original and cleans the temporary file', (t) => {
  const root = project(t)
  writeFileSync(join(root, 'existing.txt'), 'before')
  t.mock.method(fs, 'renameSync', () => { throw new Error('injected rename failure') })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  assert.throws(() => writeProjectFile(root, 'existing.txt', 'after', hash('before')), /injected rename failure/)
  assert.equal(readFileSync(join(root, 'existing.txt'), 'utf8'), 'before')
  assert.deepEqual(readdirSync(root), ['existing.txt'])
})

test('secret-bearing writes reject before touching disk and errors reveal categories only', (t) => {
  const root = project(t)
  const secret = 'sk-ant-api03-' + 'a'.repeat(32)
  writeFileSync(join(root, 'existing.txt'), 'safe')
  for (const [path, expected] of [['new/file.txt', null], ['existing.txt', hash('safe')]]) {
    assert.throws(() => writeProjectFile(root, path, secret, expected), (error) => {
      assert.match(error.message, /secret|anthropic-key/i)
      assert.ok(!error.message.includes(secret))
      return true
    })
  }
  assert.equal(readFileSync(join(root, 'existing.txt'), 'utf8'), 'safe')
  assert.deepEqual(readdirSync(root), ['existing.txt'])
})

test('invalid CAS tokens and non-string content reject before a new file is created', (t) => {
  const root = project(t)
  for (const expected of [undefined, '', 'not-a-hash', 42]) assert.throws(() => writeProjectFile(root, 'new.txt', 'content', expected), /sha|expected/i)
  for (const content of [null, {}, Buffer.from('bytes')]) assert.throws(() => writeProjectFile(root, 'new.txt', content, null), /text|content|string/i)
  assert.deepEqual(readdirSync(root), [])
})
