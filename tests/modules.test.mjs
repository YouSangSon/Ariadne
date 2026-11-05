import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../', import.meta.url))
const guarded = ['POSTGRES_HOST', 'PGVECTOR_TEST_URL', 'AKASHA_WRITE_CONCURRENCY_TEST', 'RUN_EVAL', 'DATABASE_URL', 'ARIADNE_SMOKE_DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-modules-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of ['bin', 'lib', 'scripts', 'tests', 'tools', 'core/domain', 'core/application', 'modules/integration', 'packages/memory', 'packages/code', 'modules/ontology']) mkdirSync(join(root, path), { recursive: true })
  for (const path of ['bin/Ariadne.mjs', 'bin/code.mjs', 'lib/command.mjs', 'lib/scrub.mjs', 'lib/module-selection.mjs', 'scripts/product.mjs', 'scripts/verify.mjs', 'scripts/mirror-lib.mjs', 'core/domain/product.mjs', 'core/application/product.mjs', 'core/application/verification.mjs', 'core/domain/verification.mjs', 'core/domain/commit.mjs', 'modules/integration/application.mjs', 'modules/integration/domain.mjs', 'modules/integration/files.mjs', 'lib/caps.mjs']) copyFileSync(join(source, path), join(root, path))
  writeFileSync(join(root, 'scripts/check-mirror.mjs'), '')
  const record = `import { appendFileSync } from 'node:fs'; import test from 'node:test'; test('fixture', () => appendFileSync(process.env.MODULE_TEST_LOG, JSON.stringify({ kind: KIND, cwd: process.cwd(), env: Object.fromEntries(${JSON.stringify(guarded)}.map(key => [key, Object.hasOwn(process.env, key)])) }) + '\\n'))`
  writeFileSync(join(root, 'tests/core.test.mjs'), record.replace('KIND', "'core'"))
  writeFileSync(join(root, 'tests/ontology.test.mjs'), record.replace('KIND', "'ontology'"))
  writeFileSync(join(root, 'tests/product-code.test.mjs'), record.replace('KIND', "'code'"))
  writeFileSync(join(root, 'tests/product-mcp.test.mjs'), "throw new Error('MCP must run only in its dedicated gate')\n")
  writeFileSync(join(root, 'modules/ontology/cli.mjs'), 'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }))\n')
  writeFileSync(join(root, 'tools/npm'), `#!${process.execPath}
const { appendFileSync } = require('node:fs')
const { basename } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(process.env.MODULE_TEST_LOG, JSON.stringify({ kind: 'npm', cwd: process.cwd(), args, env: Object.fromEntries(${JSON.stringify(guarded)}.map(key => [key, Object.hasOwn(process.env, key)])), onnx: process.env.ONNXRUNTIME_NODE_INSTALL }) + '\\n')
if (process.env.MODULE_TEST_FAIL === basename(process.cwd()) + ':' + args.join(' ')) process.exit(17)
`, { mode: 0o755 })
  for (const args of [['init', '-q'], ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'test: fixture\n\nREQ: none (isolated fixture)']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const log = join(root, 'calls.jsonl')
  const env = { ...process.env, ...Object.fromEntries(guarded.map((key) => [key, 'fixture-value'])), PATH: `${join(root, 'tools')}:${process.env.PATH}`, MODULE_TEST_LOG: log }
  delete env.NODE_TEST_CONTEXT
  return { root, log, env }
}

function run(f, entry, args, options = {}) {
  return spawnSync(process.execPath, [join(f.root, entry), ...args], { cwd: options.cwd ?? f.root, env: { ...f.env, ...options.env }, encoding: 'utf8', timeout: 30000 })
}

function calls(f) {
  return existsSync(f.log) ? readFileSync(f.log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
}

function commands(records) {
  return records.filter(({ kind }) => kind === 'npm').map(({ cwd, args }) => `${basename(cwd)}:${args.join(' ')}`)
}

test('module selections reject invalid input before any lifecycle action', (t) => {
  const f = fixture(t)
  for (const args of [
    ['--modules'], ['--modules='], ['--modules', ''], ['--modules', 'core,'],
    ['--modules=memory,,code'], ['--modules=other'], ['--modules=core,core'],
    ['--modules=code,code'], ['--modules=code', '--modules=memory'], ['--modules=core', 'extra'],
  ]) {
    for (const action of ['setup', 'verify']) {
      const result = run(f, 'bin/Ariadne.mjs', [action, ...args])
      assert.equal(result.status, 2, `${action} ${args.join(' ')}: ${result.stdout}${result.stderr}`)
      assert.notEqual(result.stderr.trim(), '')
      assert.equal(result.stdout, '')
    }
  }
  for (const [entry, args] of [['scripts/product.mjs', ['build', '--modules=unknown']], ['scripts/product.mjs', ['test', '--modules=code', 'extra']], ['scripts/verify.mjs', ['--modules=unknown']], ['scripts/verify.mjs', ['--root']]]) {
    const result = run(f, entry, args)
    assert.equal(result.status, 2, result.stdout + result.stderr)
  }
  assert.deepEqual(calls(f), [])
})

test('setup and build run only selected package commands, with all modules by default', (t) => {
  const f = fixture(t)
  for (const [entry, args, scope, expected] of [
    ['bin/Ariadne.mjs', ['setup', '--modules', 'core,ontology'], 'core,ontology', []],
    ['bin/Ariadne.mjs', ['setup', '--modules=memory,ontology'], 'core,memory,ontology', ['memory:ci', 'memory:run build']],
    ['scripts/product.mjs', ['build', '--modules', 'code'], 'core,code', ['code:run build']],
    ['bin/Ariadne.mjs', ['setup'], 'core,memory,code,ontology', ['memory:ci', 'code:ci', 'memory:run build', 'code:run build']],
  ]) {
    rmSync(f.log, { force: true })
    const result = run(f, entry, args)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.ok(result.stdout.includes(`product: ${args[0]} modules=${scope}\n`))
    assert.ok(result.stdout.includes(`product: ${args[0]} complete modules=${scope}\n`))
    const records = calls(f)
    assert.deepEqual(commands(records), expected)
    assert.ok(records.every(({ onnx }) => onnx === 'skip'))
    assert.ok(records.every(({ cwd }) => cwd === realpathSync(join(f.root, 'packages', basename(cwd)))))
  }
})

test('product gates run core sources and only selected package gates with a sanitized environment', (t) => {
  const f = fixture(t)
  for (const [action, modules, scope, kinds, expected] of [
    ['verify', 'core,ontology', 'core,ontology', ['core', 'ontology'], []],
    ['verify', 'memory', 'core,memory', ['core', 'ontology'], ['memory:run typecheck', 'memory:test -- --maxWorkers=1', 'memory:run audit:dependencies']],
    ['test', 'code', 'core,code', ['code', 'core', 'ontology'], ['code:test']],
    ['verify', null, 'core,memory,code,ontology', ['code', 'core', 'ontology'], ['memory:run typecheck', 'memory:test -- --maxWorkers=1', 'memory:run audit:dependencies', 'code:run verify']],
  ]) {
    rmSync(f.log, { force: true })
    const args = [action, ...(modules ? ['--modules', modules] : [])]
    const result = run(f, 'scripts/product.mjs', args)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.ok(result.stdout.includes(`product: ${action} modules=${scope}\n`))
    assert.ok(result.stdout.includes(`product: ${action} complete modules=${scope}\n`))
    assert.ok(result.stdout.includes(scope.includes('code') ? 'verify: source tests + code integration' : 'verify: source tests only'))
    const records = calls(f)
    assert.deepEqual(records.filter(({ kind }) => kind !== 'npm').map(({ kind }) => kind).sort(), kinds)
    assert.deepEqual(commands(records), expected)
    assert.ok(records.every(({ env }) => Object.values(env).every((present) => !present)))
    assert.ok(records.filter(({ kind }) => kind === 'npm').every(({ onnx }) => onnx === 'skip'))
    assert.ok(records.every(({ kind, cwd }) => cwd === realpathSync(kind === 'npm' ? join(f.root, 'packages', basename(cwd)) : f.root)))
  }
})

test('direct core verification excludes optional integration tests even with database settings', (t) => {
  const f = fixture(t)
  rmSync(join(f.root, 'packages'), { recursive: true })
  const setup = run(f, 'bin/Ariadne.mjs', ['setup', '--modules=core'])
  assert.equal(setup.status, 0, setup.stdout + setup.stderr)
  const result = run(f, 'scripts/verify.mjs', [])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /verify: source tests only/)
  assert.deepEqual(calls(f).map(({ kind }) => kind).sort(), ['core', 'ontology'])
  rmSync(f.log)
  const caller = mkdtempSync(join(tmpdir(), 'ariadne-verify-caller-'))
  t.after(() => rmSync(caller, { recursive: true, force: true }))
  const explicitRoot = run(f, 'scripts/verify.mjs', ['--root', f.root, '--modules=ontology'], { cwd: caller })
  assert.equal(explicitRoot.status, 0, explicitRoot.stdout + explicitRoot.stderr)
  assert.deepEqual(calls(f).map(({ kind }) => kind).sort(), ['core', 'ontology'])
})

test('requested code integration fails when its build is absent', (t) => {
  const f = fixture(t)
  copyFileSync(join(source, 'tests/product-code.test.mjs'), join(f.root, 'tests/product-code.test.mjs'))
  const result = run(f, 'scripts/verify.mjs', ['--modules=code'])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /verify: source tests \+ code integration/)
  assert.match(result.stderr, /Ariadne setup --modules code/)
})

test('requested code integration fails when its test is missing', (t) => {
  const f = fixture(t)
  rmSync(join(f.root, 'tests/product-code.test.mjs'))
  const result = run(f, 'scripts/product.mjs', ['verify', '--modules=code'])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /code integration test is missing/)
  assert.deepEqual(calls(f), [])
})

test('package failures stop the gate and preserve its exit status', (t) => {
  const f = fixture(t)
  const result = run(f, 'scripts/product.mjs', ['verify'], { env: { MODULE_TEST_FAIL: 'memory:test -- --maxWorkers=1' } })
  assert.equal(result.status, 17, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, /product: verify complete/)
  assert.deepEqual(commands(calls(f)), ['memory:run typecheck', 'memory:test -- --maxWorkers=1'])
})

test('runtime dispatch retains the caller cwd and missing builds name their setup module', (t) => {
  const f = fixture(t)
  const caller = mkdtempSync(join(tmpdir(), 'ariadne-module-caller-'))
  t.after(() => rmSync(caller, { recursive: true, force: true }))
  const result = run(f, 'bin/Ariadne.mjs', ['ontology', 'inspect', '--example'], { cwd: caller })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { cwd: realpathSync(caller), args: ['inspect', '--example'] })
  for (const module of ['memory', 'code']) {
    const missing = run(f, 'bin/Ariadne.mjs', [module, module === 'memory' ? 'pack' : '--help'], { cwd: caller })
    assert.equal(missing.status, 2, missing.stderr)
    assert.ok(missing.stderr.includes(`Ariadne setup --modules ${module}`))
  }
})
