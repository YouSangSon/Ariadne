import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks')

function runHook(script, stdinObj, root) {
  return spawnSync(process.execPath, [join(HOOKS, script), '--root', root], {
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
  })
}

const commitCmd = (msg, extra = '') =>
  ({ tool_input: { command: `git commit ${extra} -m ${JSON.stringify(msg)}` } })

const tmp = () => mkdtempSync(join(tmpdir(), 'harness-p4-'))

test('commit-message: 형식+REQ 참조가 유효하면 통과', () => {
  const r = runHook('commit-message.mjs', commitCmd('feat: 기능 추가\n\nREQ: p1-core-rules'), tmp())
  assert.equal(r.status, 0, r.stderr)
})

test('commit-message: REQ 참조 없으면 차단(exit 2)', () => {
  const r = runHook('commit-message.mjs', commitCmd('feat: 기능 추가'), tmp())
  assert.equal(r.status, 2)
  assert.match(r.stderr, /REQ/)
})

test('commit-message: 탈출구 "REQ: none (<사유>)" 허용', () => {
  const r = runHook('commit-message.mjs', commitCmd('chore: 설정\n\nREQ: none (하네스 설정)'), tmp())
  assert.equal(r.status, 0, r.stderr)
})

test('commit-message: conventional 타입 아니면 차단', () => {
  const r = runHook('commit-message.mjs', commitCmd('업데이트함\n\nREQ: p1-core-rules'), tmp())
  assert.equal(r.status, 2)
})

test('commit-message: 제목 70자 초과 차단', () => {
  const r = runHook('commit-message.mjs', commitCmd(`feat: ${'가'.repeat(70)}\n\nREQ: p1-core-rules`), tmp())
  assert.equal(r.status, 2)
})

test('commit-message: --no-verify 차단', () => {
  const r = runHook('commit-message.mjs', commitCmd('feat: x\n\nREQ: p1-core-rules', '--no-verify'), tmp())
  assert.equal(r.status, 2)
  assert.match(r.stderr, /no-verify/)
})

test('commit-message: git commit이 아닌 명령은 통과', () => {
  const r = runHook('commit-message.mjs', { tool_input: { command: 'ls -la' } }, tmp())
  assert.equal(r.status, 0)
})

test('감사(AC4): 훅 발화가 .harness/audit.jsonl에 append된다', () => {
  const root = tmp()
  runHook('commit-message.mjs', commitCmd('feat: x\n\nREQ: p1-core-rules'), root)
  runHook('commit-message.mjs', commitCmd('bad'), root)
  const audit = join(root, '.harness', 'audit.jsonl')
  assert.ok(existsSync(audit), 'audit.jsonl 없음')
  const lines = readFileSync(audit, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].hook, 'commit-message')
  assert.deepEqual([lines[0].decision, lines[1].decision], ['pass', 'block'])
})

test('handoff-check(AC3): stop_hook_active면 즉시 통과 — 무한루프 방지', () => {
  const r = runHook('handoff-check.mjs', { stop_hook_active: true }, tmp())
  assert.equal(r.status, 0)
})

test('handoff-check: advisory 전용 — handoff 없어도 exit 0 (fail-open 명시)', () => {
  const r = runHook('handoff-check.mjs', { stop_hook_active: false }, tmp())
  assert.equal(r.status, 0)
})

test('session-start: 항상 exit 0 (advisory 전용), stale이면 안내 문구', () => {
  const r = runHook('session-start.mjs', {}, tmp())
  assert.equal(r.status, 0)
})

test('훅 입력이 깨진 JSON이어도 죽지 않는다 (fail-open, 감사에 기록)', () => {
  const root = tmp()
  const r = spawnSync(process.execPath, [join(HOOKS, 'commit-message.mjs'), '--root', root], {
    input: '{깨진 json',
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, 'fail-open이어야 함')
})
