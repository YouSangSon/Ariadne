import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadContract, sourceState } from '../modules/loop/contract.mjs'

const req = (criteria = `    - id: AC1
      priority: P0
      statement: First observable result
      verification: node --test
      passes: null
    - id: AC2
      priority: P1
      statement: Second observable result
      verification: Observe the result
      passes: false`) => `schema_version: 1
kind: harness.requirement
metadata:
  req_id: demo
  status: ready_for_routing
functional_contract:
  acceptance_criteria:
${criteria}
verification:
  evidence: []
`

function project(t, yaml = req()) {
  const root = mkdtempSync(join(tmpdir(), 'ariadne-contract-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.harness/reqs'), { recursive: true })
  writeFileSync(join(root, '.harness/reqs/demo.yaml'), yaml)
  return root
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function repository(t) {
  const root = project(t)
  git(root, 'init', '-q')
  writeFileSync(join(root, 'sample.txt'), 'tracked\n')
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
  return root
}

test('loadContract derives every canonical AC, including non-P0 criteria', (t) => {
  const contract = loadContract(project(t), 'demo')
  assert.deepEqual(contract.criteria, [
    { id: 'AC1', statement: 'First observable result', verification: 'node --test' },
    { id: 'AC2', statement: 'Second observable result', verification: 'Observe the result' },
  ])
  assert.equal(contract.req_id, 'demo')
  assert.equal(contract.status, 'ready_for_routing')
  assert.match(contract.hash, /^[a-f0-9]{64}$/)
})

test('canonical quoted and multiline scalars retain their YAML string meaning', (t) => {
  const root = project(t, req(`    - id: 'AC1' # stable ID
      statement: |-
        First line
        # literal text
        Last line
      verification: >-
        Observe the first
        and second result
    - id: AC2
      statement: 'User''s result: # literal'
      verification: "node --test\\nnext" # comment`))
  assert.deepEqual(loadContract(root, 'demo').criteria, [
    { id: 'AC1', statement: 'First line\n# literal text\nLast line', verification: 'Observe the first and second result' },
    { id: 'AC2', statement: "User's result: # literal", verification: 'node --test\nnext' },
  ])
})

test('passes, evidence, and lifecycle status do not change the approved contract hash', (t) => {
  const root = project(t)
  const file = join(root, '.harness/reqs/demo.yaml')
  const before = loadContract(root, 'demo')
  writeFileSync(file, req().replace('ready_for_routing', 'verified').replace('passes: null', 'passes: true').replace('evidence: []', 'evidence:\n    - result: passed'))
  assert.equal(loadContract(root, 'demo').hash, before.hash)
  for (const [from, to] of [['First observable result', 'Changed result'], ['node --test', 'node tests/check.mjs'], ['id: AC1', 'id: AC3']]) {
    writeFileSync(file, req().replace(from, to))
    assert.notEqual(loadContract(root, 'demo').hash, before.hash)
  }
})

test('approved scope and gate fields change the contract hash while attempts and evidence do not', (t) => {
  const root = project(t)
  const file = join(root, '.harness/reqs/demo.yaml')
  const yaml = req().replace('verification:\n  evidence: []', `requirement:
  user_intent: Original intent
  desired_outcome: Original outcome
  confirmed_facts: []
  assumptions: []
code_mapping:
  boundary_rules: []
audit:
  must_not_implement: []
verification:
  commands: [node --test]
  verify_gate_required: true
  verify_gate_reason: Original gate
  escalate_after: 3
  attempts: []
  evidence: []`)
  writeFileSync(file, yaml)
  const before = loadContract(root, 'demo').hash
  for (const [from, to] of [
    ['Original intent', 'New intent'], ['Original outcome', 'New outcome'],
    ['confirmed_facts: []', 'confirmed_facts: [new fact]'], ['assumptions: []', 'assumptions: [new assumption]'],
    ['boundary_rules: []', 'boundary_rules: [new boundary]'], ['must_not_implement: []', 'must_not_implement: [new prohibition]'],
    ['commands: [node --test]', 'commands: [node other.mjs]'], ['verify_gate_required: true', 'verify_gate_required: false'],
    ['Original gate', 'New gate'], ['escalate_after: 3', 'escalate_after: 4'],
  ]) {
    writeFileSync(file, yaml.replace(from, to))
    assert.notEqual(loadContract(root, 'demo').hash, before, from)
  }
  writeFileSync(file, yaml.replace('attempts: []', 'attempts:\n    - blocker: observed failure').replace('evidence: []', 'evidence:\n    - result: passed'))
  assert.equal(loadContract(root, 'demo').hash, before)
})

test('all four known statuses are returned and invalid or mismatched metadata rejects', (t) => {
  const root = project(t)
  const file = join(root, '.harness/reqs/demo.yaml')
  for (const status of ['needs_intake', 'needs_clarification', 'ready_for_routing', 'verified']) {
    writeFileSync(file, req().replace('ready_for_routing', status))
    assert.equal(loadContract(root, 'demo').status, status)
  }
  for (const yaml of [req().replace('req_id: demo', 'req_id: other'), req().replace('  req_id: demo\n', ''), req().replace('ready_for_routing', 'paused'), req().replace('  status: ready_for_routing\n', '')]) {
    writeFileSync(file, yaml)
    assert.throws(() => loadContract(root, 'demo'), /REQ|metadata/)
  }
  for (const id of ['', '../demo', 'Demo', null]) assert.throws(() => loadContract(root, id), /REQ|slug/)
})

test('duplicate fields and AC IDs cannot silently discard criteria', (t) => {
  const root = project(t)
  const file = join(root, '.harness/reqs/demo.yaml')
  for (const yaml of [
    req() + 'metadata:\n  req_id: demo\n',
    req().replace('  req_id: demo', '  req_id: demo\n  req_id: demo'),
    req().replace('  status: ready_for_routing', '  status: ready_for_routing\n  status: verified'),
    req().replace('  acceptance_criteria:', '  acceptance_criteria: []\n  acceptance_criteria:'),
    req().replace('id: AC2', 'id: AC1'),
    req().replace('      statement: First observable result', '      statement: First observable result\n      statement: replacement'),
    req().replace('metadata:', 'metadata:\n  "req_id": demo'),
  ]) {
    writeFileSync(file, yaml)
    assert.throws(() => loadContract(root, 'demo'), /REQ|duplicate|중복|unsupported/)
  }
})

test('missing, empty, and unsupported AC forms fail closed', (t) => {
  const root = project(t)
  const file = join(root, '.harness/reqs/demo.yaml')
  for (const criteria of [
    '', '    []', '    - {id: AC1, statement: result, verification: observe}',
    '    - id:AC1\n      statement: result\n      verification: observe',
    '    - id: AC1\n      statement: result',
    '    - id: AC1\n      statement:result\n      verification: observe',
    '    - id: AC1\n      statement: ""\n      verification: observe',
    '    - id: AC1\n      statement: null\n      verification: observe',
    '    - id: AC1\n      statement: result: ambiguous\n      verification: observe',
    '    - id: AC1\n      statement: *previous\n      verification: observe',
    '    - id: AC1\n      statement: &value result\n      verification: observe',
    '    - id: AC1\n      statement: result\n      verification: [observe]',
    '    - id: AC1\n      statement: result\n      verification: observe\n      extra: unowned',
    '   - id: AC1\n     statement: result\n     verification: observe',
    '    - id: AC1\n      statement: first\n        continuation\n      verification: observe',
  ]) {
    writeFileSync(file, req(criteria))
    assert.throws(() => loadContract(root, 'demo'), /REQ|criteria|scalar|unsupported/)
  }
  for (const yaml of [req().replace('  acceptance_criteria:', '  acceptance_criteria: []'), req().replace('functional_contract:', '"functional_contract":'), req().replace('  req_id: demo', '\treq_id: demo'), req().replace('  req_id: demo', '  req_id:demo')]) {
    writeFileSync(file, yaml)
    assert.throws(() => loadContract(root, 'demo'), /REQ|mapping|unsupported/)
  }
})

test('contract loading rejects symlinks and inputs beyond 1 MiB', (t) => {
  const root = project(t)
  const outside = project(t)
  const file = join(root, '.harness/reqs/demo.yaml')
  unlinkSync(file)
  symlinkSync(join(outside, '.harness/reqs/demo.yaml'), file)
  assert.throws(() => loadContract(root, 'demo'), /symlink|symbolic/i)
  unlinkSync(file)
  writeFileSync(file, req() + '#'.repeat(1024 * 1024))
  assert.throws(() => loadContract(root, 'demo'), /size|MiB|large/i)
})

test('sourceState includes dirty and untracked inputs and excludes selected REQ/runtime files', (t) => {
  const root = repository(t)
  const before = sourceState(root, { reqId: 'demo' })
  assert.deepEqual(before.files, ['sample.txt'])
  assert.equal(before.head, git(root, 'rev-parse', 'HEAD'))
  writeFileSync(join(root, '.harness/reqs/demo.yaml'), req().replace('passes: null', 'passes: true'))
  mkdirSync(join(root, '.harness/handoff'), { recursive: true })
  writeFileSync(join(root, '.harness/handoff/runtime.json'), 'runtime')
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'node_modules/generated.js'), 'ignored')
  assert.equal(sourceState(root, { reqId: 'demo' }).hash, before.hash)
  writeFileSync(join(root, '.harness/reqs/other.yaml'), 'other REQ')
  const otherReq = sourceState(root, { reqId: 'demo' })
  assert.notEqual(otherReq.hash, before.hash)
  assert.ok(otherReq.files.includes('.harness/reqs/other.yaml'))
  writeFileSync(join(root, 'sample.txt'), 'dirty\n')
  assert.notEqual(sourceState(root, { reqId: 'demo' }).hash, otherReq.hash)
  writeFileSync(join(root, 'new.txt'), 'untracked\n')
  assert.ok(sourceState(root).files.includes('new.txt'))
  assert.ok(sourceState(root).files.includes('.harness/reqs/demo.yaml'))
})

test('HEAD is provenance and identical file inputs keep their hash across commits and roots', (t) => {
  const root = repository(t)
  const before = sourceState(root)
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'provenance only')
  const after = sourceState(root)
  assert.notEqual(after.head, before.head)
  assert.equal(after.hash, before.hash)
  assert.equal(sourceState(repository(t)).hash, before.hash)
})

test('path, mode, kind, deletion, and symlink target affect source hash without following links', (t) => {
  const root = repository(t)
  const file = join(root, 'sample.txt')
  const before = sourceState(root)
  chmodSync(file, 0o755)
  assert.notEqual(sourceState(root).hash, before.hash)
  chmodSync(file, 0o644)
  unlinkSync(file)
  const removed = sourceState(root)
  assert.notEqual(removed.hash, before.hash)
  assert.ok(removed.files.includes('sample.txt'))
  const outside = project(t)
  writeFileSync(join(outside, 'big.txt'), 'x'.repeat(1024 * 1024 + 1))
  symlinkSync(join(outside, 'big.txt'), file)
  const linked = sourceState(root)
  assert.notEqual(linked.hash, removed.hash)
  writeFileSync(join(outside, 'big.txt'), 'changed outside root')
  assert.equal(sourceState(root).hash, linked.hash)
  unlinkSync(file)
  symlinkSync(join(outside, 'different.txt'), file)
  assert.notEqual(sourceState(root).hash, linked.hash)
})

test('sourceState rejects symlink ancestors and oversized regular input files', (t) => {
  const root = repository(t)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/code.txt'), 'inside')
  git(root, 'add', 'src/code.txt')
  rmSync(join(root, 'src'), { recursive: true })
  const outside = project(t)
  writeFileSync(join(outside, 'code.txt'), 'outside')
  symlinkSync(outside, join(root, 'src'))
  assert.throws(() => sourceState(root), /symlink|symbolic/i)
  unlinkSync(join(root, 'src'))
  writeFileSync(join(root, 'sample.txt'), 'x'.repeat(1024 * 1024 + 1))
  assert.throws(() => sourceState(root), /size|MiB|large/i)
})

test('sourceState supports an unborn HEAD and rejects non-repositories', (t) => {
  const root = project(t)
  assert.throws(() => sourceState(root), /git|repository/i)
  git(root, 'init', '-q')
  assert.equal(sourceState(root).head, null)
  assert.equal(readFileSync(join(root, '.harness/reqs/demo.yaml'), 'utf8'), req())
})
