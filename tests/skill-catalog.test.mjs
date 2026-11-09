import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const cli = fileURLToPath(new URL('../bin/Ariadne.mjs', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-skills-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'skills', 'research'), { recursive: true })
  const text = '---\nname: research\ndescription: Find primary sources\n---\n\nRead source evidence before making claims.\n'
  writeFileSync(join(root, 'skills', 'research', 'SKILL.md'), text)
  const sha = createHash('sha256').update(text).digest('hex')
  return { root, text, selection: `research@${sha}` }
}
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args, '--root', root], { encoding: 'utf8', timeout: 10000 })

test('catalog exposes metadata and a content-pinned selection without skill body', (t) => {
  const f = fixture(t)
  const result = run(f.root, 'skills')
  assert.equal(result.status, 0, result.stderr)
  const catalog = JSON.parse(result.stdout)
  assert.equal(catalog.trust, 'untrusted_reference_not_permission')
  assert.equal(catalog.skills[0].selection, f.selection)
  assert.equal(catalog.skills[0].description, 'Find primary sources')
  assert.ok(!result.stdout.includes('Read source evidence'))
})

test('explicit selection includes full skill with provenance and preserves mandatory context', (t) => {
  const f = fixture(t)
  const result = run(f.root, 'context', '--skill', f.selection, '--budget', 'brief')
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes(f.text.trim()))
  assert.ok(result.stdout.includes(f.selection))
  assert.match(result.stdout, /untrusted/)
  assert.ok(result.stdout.length <= 4000)
})

test('changed selection fails with no context instead of silently accepting drift', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'skills', 'research', 'SKILL.md'), f.text + 'changed\n')
  const result = run(f.root, 'context', '--skill', f.selection)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /changed|SHA|hash/i)
})

test('selected body is never truncated to fit and optional unselected body is never included', (t) => {
  const f = fixture(t)
  const text = f.text + 'long evidence '.repeat(400)
  writeFileSync(join(f.root, 'skills', 'research', 'SKILL.md'), text)
  const selected = `research@${createHash('sha256').update(text).digest('hex')}`
  const rejected = run(f.root, 'context', '--skill', selected, '--budget', 'brief')
  assert.notEqual(rejected.status, 0)
  assert.equal(rejected.stdout, '')
  assert.match(rejected.stderr, /예산|budget/)
  const plain = run(f.root, 'context', '--budget', 'brief')
  assert.equal(plain.status, 0, plain.stderr)
  assert.ok(!plain.stdout.includes('long evidence'))
})

test('skill content is scrubbed only after checking the exact selected bytes', (t) => {
  const f = fixture(t)
  const secret = 'sk-ant-api03-' + 'x'.repeat(30)
  const text = f.text + secret
  writeFileSync(join(f.root, 'skills', 'research', 'SKILL.md'), text)
  const selected = `research@${createHash('sha256').update(text).digest('hex')}`
  const result = run(f.root, 'context', '--skill', selected)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.stdout.includes(secret))
  assert.match(result.stdout, /REDACTED/)
})

test('unsafe, duplicate, malformed and symbolic-link selections fail closed', (t) => {
  const f = fixture(t)
  for (const value of ['../research@' + '0'.repeat(64), 'research', 'research@bad']) {
    const result = run(f.root, 'context', '--skill', value)
    assert.notEqual(result.status, 0, value)
    assert.equal(result.stdout, '')
  }
  assert.notEqual(run(f.root, 'context', '--skill', f.selection, '--skill', f.selection).status, 0)
  rmSync(join(f.root, 'skills', 'research', 'SKILL.md'))
  writeFileSync(join(f.root, 'outside.md'), f.text)
  symlinkSync(join(f.root, 'outside.md'), join(f.root, 'skills', 'research', 'SKILL.md'))
  assert.notEqual(run(f.root, 'skills').status, 0)
  assert.notEqual(run(f.root, 'context', '--skill', f.selection).status, 0)
})

test('unsupported YAML, ambiguous metadata and invalid UTF-8 are rejected', (t) => {
  const f = fixture(t)
  for (const text of [
    '---\nname: research\ndescription: >\n  hidden continuation\n---\nbody',
    '---\nname: research\nname: other\ndescription: text\n---\nbody',
    '---\nname: research\ndescription: &alias value\n---\nbody',
    '---\nname: research\ndescription: plain # ambiguous comment\n---\nbody',
    Buffer.from([0xff, 0xfe]),
    f.text + 'x'.repeat(65536),
  ]) {
    writeFileSync(join(f.root, 'skills', 'research', 'SKILL.md'), text)
    const result = run(f.root, 'skills')
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('only selected skills are loaded and catalog rejects directory symlinks', (t) => {
  const f = fixture(t)
  mkdirSync(join(f.root, 'skills', 'broken'))
  writeFileSync(join(f.root, 'skills', 'broken', 'SKILL.md'), 'invalid metadata')
  assert.equal(run(f.root, 'context', '--skill', f.selection).status, 0)
  rmSync(join(f.root, 'skills', 'broken'), { recursive: true })
  symlinkSync(join(f.root, 'skills', 'research'), join(f.root, 'skills', 'alias'))
  assert.notEqual(run(f.root, 'skills').status, 0)
})

test('installed context runtime resolves the skill catalog and guarded reader closure', (t) => {
  const f = fixture(t)
  const prefix = join(f.root, 'installed')
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
  const installed = spawnSync(process.execPath, [join(sourceRoot, 'scripts/install.mjs'), '--root', sourceRoot, '--prefix', prefix], { encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: f.root } })
  assert.equal(installed.status, 0, installed.stderr)
  const catalog = spawnSync(process.execPath, [join(prefix, 'lib/skill-catalog.mjs'), '--root', prefix], { encoding: 'utf8' })
  assert.equal(catalog.status, 0, catalog.stderr)
  const selection = JSON.parse(catalog.stdout).skills.find((skill) => skill.name === 'handoff').selection
  const packed = spawnSync(process.execPath, [join(prefix, 'lib/context-pack.mjs'), '--root', prefix, '--skill', selection, '--budget', 'deep'], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  assert.match(packed.stdout, /selected_skills/)
})

test('context rejects mistyped selection flags instead of silently skipping them', (t) => {
  const f = fixture(t)
  for (const args of [['--skills', f.selection], ['--skill'], ['--skill=' + f.selection]]) {
    const result = run(f.root, 'context', ...args)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('secret-shaped skill identifiers never leak through metadata or headers', (t) => {
  const f = fixture(t)
  const id = 'sk-' + 'a'.repeat(30)
  mkdirSync(join(f.root, 'skills', id))
  const text = `---\nname: ${id}\ndescription: private\n---\nDo not publish a key.\n`
  writeFileSync(join(f.root, 'skills', id, 'SKILL.md'), text)
  const selection = `${id}@${createHash('sha256').update(text).digest('hex')}`
  for (const args of [['skills'], ['context', '--skill', selection]]) {
    const result = run(f.root, ...args)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.ok(!result.stderr.includes(id))
  }
})

test('blank-separated scalar continuations and dangling skill roots are rejected', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'skills', 'research', 'SKILL.md'), '---\nname: research\ndescription: plain\n\n  hidden continuation\n---\nbody')
  assert.notEqual(run(f.root, 'skills').status, 0)
  rmSync(join(f.root, 'skills'), { recursive: true })
  symlinkSync(join(f.root, 'missing'), join(f.root, 'skills'))
  const result = run(f.root, 'skills')
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
})
