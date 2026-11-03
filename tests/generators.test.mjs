import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')

const SKILL_SRC = `---
name: demo
description: 데모 스킬.
---

# demo

본문.
`

function makeFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'harness-p2-'))
  mkdirSync(join(root, 'skills', 'demo'), { recursive: true })
  writeFileSync(join(root, 'skills', 'demo', 'SKILL.md'), SKILL_SRC)
  mkdirSync(join(root, 'core'), { recursive: true })
  writeFileSync(join(root, 'core', 'AGENTS.core.md'), '# core\n\nrule\n')
  return root
}

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

test('generate: 미러 1행은 반드시 --- 이고 해시 스탬프를 가진다', () => {
  const root = makeFixtureRepo()
  const r = run('generate-mirrors.mjs', ['--root', root])
  assert.equal(r.status, 0, r.stderr)
  for (const dir of ['.claude', '.agents']) {
    const p = join(root, dir, 'skills', 'demo', 'SKILL.md')
    assert.ok(existsSync(p), `${dir} 미러 없음`)
    const text = readFileSync(p, 'utf8')
    assert.equal(text.split('\n')[0], '---', 'P1 실측 버그: 1행이 frontmatter가 아님')
    assert.match(text, /<!-- generated: mirror of skills\/demo\/SKILL\.md \| sha256:[0-9a-f]{12}/)
  }
})

test('check-mirror: 무드리프트 0, 변조 시 비정상 종료, 재생성 후 복구', () => {
  const root = makeFixtureRepo()
  run('generate-mirrors.mjs', ['--root', root])
  assert.equal(run('check-mirror.mjs', ['--root', root]).status, 0)

  const mirror = join(root, '.claude', 'skills', 'demo', 'SKILL.md')
  writeFileSync(mirror, readFileSync(mirror, 'utf8') + '\n변조\n')
  assert.notEqual(run('check-mirror.mjs', ['--root', root]).status, 0, '드리프트 미검출')

  run('generate-mirrors.mjs', ['--root', root])
  assert.equal(run('check-mirror.mjs', ['--root', root]).status, 0)
})

test('check-mirror: core 150줄 캡 초과를 검출한다', () => {
  const root = makeFixtureRepo()
  run('generate-mirrors.mjs', ['--root', root])
  writeFileSync(join(root, 'core', 'AGENTS.core.md'), 'x\n'.repeat(151))
  assert.notEqual(run('check-mirror.mjs', ['--root', root]).status, 0, '캡 초과 미검출')
})

test('check-mirror: 빈 HOME(클린 환경)에서도 통과한다', () => {
  const root = makeFixtureRepo()
  run('generate-mirrors.mjs', ['--root', root])
  const emptyHome = mkdtempSync(join(tmpdir(), 'harness-home-'))
  assert.equal(run('check-mirror.mjs', ['--root', root], { HOME: emptyHome }).status, 0)
})

test('install: 멱등 — 2회차는 전부 skipped, 수정 후엔 updated', () => {
  const root = makeFixtureRepo()
  run('generate-mirrors.mjs', ['--root', root])
  const prefix = mkdtempSync(join(tmpdir(), 'harness-prefix-'))

  const r1 = run('install.mjs', ['--root', root, '--prefix', prefix])
  assert.equal(r1.status, 0, r1.stderr)
  assert.match(r1.stdout, /created=[1-9]/)
  assert.ok(existsSync(join(prefix, 'manifest.json')))

  const r2 = run('install.mjs', ['--root', root, '--prefix', prefix])
  assert.match(r2.stdout, /created=0/)
  assert.match(r2.stdout, /updated=0/)

  writeFileSync(join(root, 'core', 'AGENTS.core.md'), '# core v2\n')
  const r3 = run('install.mjs', ['--root', root, '--prefix', prefix])
  assert.match(r3.stdout, /updated=1/)
})

test('uninstall: manifest 기재 파일만 제거하고 외부 파일은 보존한다', () => {
  const root = makeFixtureRepo()
  run('generate-mirrors.mjs', ['--root', root])
  const prefix = mkdtempSync(join(tmpdir(), 'harness-prefix-'))
  run('install.mjs', ['--root', root, '--prefix', prefix])

  const foreign = join(prefix, 'user-note.md')
  writeFileSync(foreign, '내 메모')

  const r = run('uninstall.mjs', ['--prefix', prefix])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!existsSync(join(prefix, 'core', 'AGENTS.core.md')), '설치 파일이 남음')
  assert.ok(!existsSync(join(prefix, 'manifest.json')), 'manifest가 남음')
  assert.ok(existsSync(foreign), '외부 파일이 삭제됨')
  rmSync(foreign)
})

test('uninstall: manifest 없으면 명확한 에러로 비정상 종료', () => {
  const empty = mkdtempSync(join(tmpdir(), 'harness-prefix-'))
  const r = run('uninstall.mjs', ['--prefix', empty])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /manifest/)
})
