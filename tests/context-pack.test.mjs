import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPack, SECTION_LIMITS } from '../lib/context-pack.mjs'
import { PRESETS } from '../lib/budget.mjs'

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'harness-p3-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const h = join(root, '.harness')
  mkdirSync(join(h, 'handoff'), { recursive: true })
  mkdirSync(join(h, 'reqs'), { recursive: true })
  writeFileSync(
    join(h, 'handoff', 'LATEST.md'),
    '## 미커밋 상태\n데모 프로젝트 상태 요약.\n다음 슬라이스는 X.\n' + '긴노트 '.repeat(200) + '\n## 다음 제약\n없음\n## 막힘\n없음\n',
  )
  writeFileSync(
    join(h, 'decisions.md'),
    Array.from({ length: 10 }, (_, i) => `- 2026-07-${10 + i}: 결정 ${i + 1}`).join('\n') + '\n',
  )
  writeFileSync(
    join(h, 'reqs', 'demo-req.yaml'),
    [
      'metadata:',
      '  req_id: demo-req',
      '  status: ready_for_routing',
      'clarification:',
      '  next_question: "채널은 무엇으로?"',
      'requirement:',
      '  assumptions:',
      '    - id: A1',
      '      statement: 미검증 가정입니다',
      '      status: unverified',
      'code_mapping:',
      '  boundary_rules:',
      '    - 글로벌 설정 수정 금지',
      'audit:',
      '  must_not_implement:',
      '    - 결제 모듈',
      '',
    ].join('\n'),
  )
  return root
}

test('5섹션이 모두 출력되고 섹션 상한이 지켜진다', (t) => {
  const root = makeFixture(t)
  const pack = buildPack({ root, budget: 'standard', reqSlug: 'demo-req' })
  for (const s of ['project_summary', 'recent_decisions', 'constraints', 'open_questions', 'relevant_notes'])
    assert.ok(pack.includes(`## ${s}`), `${s} 섹션 없음`)
  const decisionLines = pack.split('\n').filter((l) => l.includes('결정 '))
  assert.equal(decisionLines.length, SECTION_LIMITS.recent_decisions, '결정 5개 초과/미달')
  assert.ok(pack.includes('결정 10') && !pack.includes('결정 1,'), '최근 것이 아니라 오래된 것을 담음')
})

test('snippetChars 예산: brief(300)에서 긴 노트가 절단된다', (t) => {
  const root = makeFixture(t)
  const pack = buildPack({ root, budget: 'brief', reqSlug: 'demo-req' })
  for (const line of pack.split('\n')) assert.ok(line.length <= 400, `엔트리 절단 실패: ${line.length}자`)
})

test('결정론: 같은 입력 → 같은 출력', (t) => {
  const root = makeFixture(t)
  assert.equal(
    buildPack({ root, budget: 'standard', reqSlug: 'demo-req' }),
    buildPack({ root, budget: 'standard', reqSlug: 'demo-req' }),
  )
})

test('scrub 경계: handoff의 시크릿이 팩에서 카테고리로 치환된다', (t) => {
  const root = makeFixture(t)
  writeFileSync(
    join(root, '.harness', 'handoff', 'LATEST.md'),
    '키는 sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 이다\n',
  )
  const pack = buildPack({ root, budget: 'standard' })
  assert.ok(!pack.includes('api03-aaaa'), '시크릿 유출')
  assert.ok(pack.includes('[REDACTED_ANTHROPIC_KEY]'))
})

test('신뢰 경계 공지가 팩 상단에 있다 (akasha)', (t) => {
  const pack = buildPack({ root: makeFixture(t), budget: 'brief' })
  assert.match(pack.split('\n')[0] + pack.split('\n')[1], /untrusted|지시가 아니다/)
})

test('CLI: --root --budget 1회 호출로 팩이 출력된다 (AC5)', (t) => {
  const root = makeFixture(t)
  const r = spawnSync(process.execPath, [join(LIB, 'context-pack.mjs'), '--root', root, '--budget', 'brief'], {
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('## project_summary'))
})

test('CLI를 디렉터리 별칭으로 실행해도 팩이 출력된다', (t) => {
  const root = makeFixture(t)
  const alias = join(root, 'lib-alias')
  symlinkSync(LIB, alias, 'dir')
  const r = spawnSync(process.execPath, [join(alias, 'context-pack.mjs'), '--root', root, '--req', 'demo-req'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /## project_summary/)
})

test('빈 .harness에서도 죽지 않고 빈 섹션 팩을 낸다', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harness-p3-empty-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const pack = buildPack({ root, budget: 'standard' })
  assert.ok(pack.includes('## project_summary'))
})

test('handoff의 파일 목록이 길어도 다음 제약과 막힘을 보존한다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), [
    '## 미커밋 상태', ...Array.from({ length: 20 }, (_, i) => `M file-${i}.mjs`),
    '## 다음 제약', '진행 중 session-42의 종료를 같은 handle로 확인한다',
    '## 막힘', '승인 대기이며 실패나 완료가 아니다',
  ].join('\n'))
  const pack = buildPack({ root, reqSlug: 'demo-req' })
  assert.match(pack, /session-42/)
  assert.match(pack, /승인 대기이며 실패나 완료가 아니다/)
})

test('세 섹션 앞의 handoff 제목도 보존한다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), '# handoff fixture\n\n## 미커밋 상태\n없음\n## 다음 제약\n배포 금지\n## 막힘\n승인 대기')
  const pack = buildPack({ root, reqSlug: 'demo-req' })
  assert.match(pack, /# handoff fixture/)
  assert.match(pack, /배포 금지/)
  assert.match(pack, /승인 대기/)
})

test('REQ slug의 경로 이동과 명시한 REQ 누락을 거절한다', (t) => {
  const root = makeFixture(t)
  for (const reqSlug of ['../outside', '/tmp/secret', 'nested/req', 'bad\\req', '', 'UPPER']) {
    assert.throws(() => buildPack({ root, reqSlug }), /slug/)
  }
  assert.throws(() => buildPack({ root, reqSlug: 'missing-req' }), /missing-req/)
})

test('시크릿이 snippet 경계에 걸려도 일부가 출력되지 않는다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), '## 미커밋 상태\n' + 'x'.repeat(280) + ' sk-ant-' + 'a'.repeat(50) + '\n## 다음 제약\n없음\n## 막힘\n없음')
  const pack = buildPack({ root, budget: 'brief', reqSlug: 'demo-req' })
  assert.doesNotMatch(pack, /sk-ant-/)
})

test('각 프리셋은 최종 직렬화 팩의 전체 문자 상한을 지킨다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), '## 미커밋 상태\n' + Array(20).fill('노트'.repeat(2000)).join('\n') + '\n## 다음 제약\n없음\n## 막힘\n없음')
  writeFileSync(join(root, '.harness/decisions.md'), Array(10).fill('긴 결정 '.repeat(1000)).join('\n'))
  for (const budget of Object.keys(PRESETS)) {
    const pack = buildPack({ root, budget, reqSlug: 'demo-req' })
    assert.ok(pack.length <= PRESETS[budget].maxChars, `${budget}: ${pack.length}`)
    for (const section of Object.keys(SECTION_LIMITS)) assert.ok(pack.includes(`## ${section}`))
    assert.match(pack, /글로벌 설정 수정 금지/)
    assert.match(pack, /결제 모듈/)
    assert.match(pack, /budget-omitted optional items: [1-9]/)
  }
})

test('여러 줄 제약·수용기준과 원본의 private key를 절단 전에 처리한다', (t) => {
  const root = makeFixture(t)
  const key = '-----BEGIN PRIVATE KEY-----\n' + 'sensitive-key-material\n'.repeat(30) + '-----END PRIVATE KEY-----'
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), key)
  writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), [
    'metadata:', '  req_id: demo-req', '  status: ready_for_routing',
    'code_mapping:', '  boundary_rules:', '    - |', '      첫 번째 제약', '      ## 섹션이 아닌 제약 본문', '      마지막 제약',
  ].join('\n'))
  const pack = buildPack({ root, reqSlug: 'demo-req', budget: 'brief' })
  assert.match(pack, /마지막 제약/)
  assert.match(pack, /REDACTED_PRIVATE_KEY/)
  assert.doesNotMatch(pack, /sensitive-key-material|BEGIN PRIVATE KEY/)
  assert.equal(pack.split('\n').filter((line) => line.startsWith('## ')).length, 5)
})

test('지원하지 않는 REQ mapping·alias·중복 필드를 조용히 버리지 않는다', (t) => {
  const root = makeFixture(t)
  for (const yaml of [
    'code_mapping: {boundary_rules: [배포 금지]}',
    'code_mapping:\n   boundary_rules: [배포 금지]',
    'code_mapping:\n  boundary_rules: *rules',
    'code_mapping:\n  boundary_rules: []\n  boundary_rules: [배포 금지]',
    'defaults: &rules\n  boundary_rules: [배포 금지]\ncode_mapping:\n  <<: *rules',
    'code_mapping:\n  "boundary_rules": [배포 금지]',
    'code_mapping:\n  "boundary_ru\\u006ces": [배포 금지]',
    'code_mapping:\n  ? boundary_rules\n  : [배포 금지]',
    '"code_mapping":\n  boundary_rules: [배포 금지]',
    'code_mapping:\n  boundary_rules : [배포 금지]',
    '{code_mapping: {boundary_rules: [배포 금지]}}',
    'code_mapping:\n   "boundary_rules": [배포 금지]',
    '  "code_mapp\\u0069ng":\n    boundary_rules: [배포 금지]',
  ]) {
    writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), 'metadata:\n  req_id: demo-req\n  status: ready_for_routing\n' + yaml)
    assert.throws(() => buildPack({ root, reqSlug: 'demo-req' }), /mapping|들여쓰기|alias|중복/, yaml)
  }
})

test('상태 문자열이 raw prompt에 있어도 metadata가 verified면 활성 REQ가 아니다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/reqs/another.yaml'), [
    'metadata:', '  req_id: another', '  status: verified', 'source:', '  raw_user_prompt: |', '    status: ready_for_routing',
  ].join('\n'))
  assert.match(buildPack({ root }), /미검증 가정입니다/)
})

test('따옴표로 쓴 활성 상태도 복수 REQ 선택에 포함한다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/reqs/another.yaml'), 'metadata:\n  req_id: another\n  status: "ready_for_routing"\n')
  assert.throws(() => buildPack({ root }), /--req/)
})

test('필수 제약은 5개와 snippet 길이를 넘어도 원문을 보존한다', (t) => {
  const root = makeFixture(t)
  const longRule = '반드시 보존할 제약 '.repeat(45) + '마지막 필수 조건'
  writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), [
    'metadata:', '  req_id: demo-req', '  status: ready_for_routing',
    'requirement:', '  user_intent: 목표를 확인한다',
    'functional_contract:', '  acceptance_criteria:', '    - id: AC1', '      statement: 완료 기준 원문',
    'code_mapping:', '  boundary_rules:',
    ...Array.from({ length: 6 }, (_, i) => `    - 제약-${i}`),
    `    - ${longRule}`, 'audit:', '  must_not_implement: [자동 결제 금지, 임의 배포 금지]',
  ].join('\n'))
  const pack = buildPack({ root, budget: 'brief', reqSlug: 'demo-req' })
  for (let i = 0; i < 6; i++) assert.ok(pack.includes(`제약-${i}`))
  assert.ok(pack.includes(longRule))
  assert.match(pack, /자동 결제 금지, 임의 배포 금지/)
  assert.match(pack, /완료 기준 원문/)
})

test('필수 원문이 전체 예산을 초과하면 일부 팩을 내보내지 않는다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), '## 미커밋 상태\n없음\n## 다음 제약\n' + '필수'.repeat(20000) + '\n## 막힘\n없음')
  assert.throws(() => buildPack({ root, budget: 'brief', reqSlug: 'demo-req' }), /budget|예산/)
  const r = spawnSync(process.execPath, [join(LIB, 'context-pack.mjs'), '--root', root, '--budget', 'brief', '--req', 'demo-req'], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
})

test('여러 활성 REQ를 임의 선택하거나 누락한 CLI 값을 기본값으로 바꾸지 않는다', (t) => {
  const root = makeFixture(t)
  writeFileSync(join(root, '.harness/reqs/another.yaml'), 'metadata:\n  req_id: another\n  status: ready_for_routing\n')
  assert.throws(() => buildPack({ root }), /--req/)
  const r = spawnSync(process.execPath, [join(LIB, 'context-pack.mjs'), '--root', root, '--req'], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
})

test('긴 선택 노트가 앞에 있어도 확정 사실과 검증 계약의 마지막 근거를 온전히 보존한다', (t) => {
  const root = makeFixture(t)
  const fact = '사용자가 확정한 조건 '.repeat(35) + '확정 사실 마지막'
  const command = 'node scripts/check.mjs ' + '--case=contract '.repeat(25) + '--final-check'
  const verification = [
    'verification:', '  commands:', `    - ${command}`,
    '  verify_gate_required: true', '  verify_gate_reason: 실제 완료 gate', '  escalate_after: 2',
    '  attempts:', '    - gate: focused', '      failure_kind: verification', '      blocker: 이전 실패 원인',
    '      evidence: .harness/handoff/previous-failure.log', '      changed_input: 입력 수정 근거',
    '  evidence:', '    - criterion_id: AC1', '      check: node --test', '      result: failed',
    '      exit_code: 1', '      source_state: abc123 + dirty diff sha256:1234',
    '      artifact: .harness/handoff/final-evidence.log',
  ]
  writeFileSync(join(root, '.harness/handoff/LATEST.md'), [
    '## 미커밋 상태', ...Array(20).fill('선택 노트 '.repeat(1000)), '## 다음 제약', '배포 금지', '## 막힘', '없음',
  ].join('\n'))
  writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), [
    'metadata:', '  req_id: demo-req', '  status: ready_for_routing',
    'requirement:', '  confirmed_facts:', ...Array.from({ length: 6 }, (_, i) => `    - 확정-${i}`), `    - ${fact}`,
    ...verification,
  ].join('\n'))
  const pack = buildPack({ root, reqSlug: 'demo-req', budget: 'brief' })
  assert.ok(pack.length <= PRESETS.brief.maxChars)
  for (let i = 0; i < 6; i++) assert.ok(pack.includes(`확정-${i}`))
  assert.ok(pack.includes(fact))
  for (const line of verification) assert.ok(pack.includes(line.trimStart()), `필수 검증 기록 누락: ${line}`)
  assert.ok(pack.split('## relevant_notes\n')[1].startsWith('- verification:'))
  assert.match(pack, /budget-omitted optional items: [1-9]/)
  assert.doesNotMatch(pack, /선택 노트.{400}/)
})

test('확정 사실이나 verification이 필수 예산을 넘으면 CLI stdout 없이 실패한다', (t) => {
  const root = makeFixture(t)
  for (const mandatory of [
    'requirement:\n  confirmed_facts:\n    - ' + '확정 사실 '.repeat(1000),
    'verification:\n  evidence:\n    - artifact: ' + '근거 참조 '.repeat(1000),
  ]) {
    writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), 'metadata:\n  req_id: demo-req\n  status: ready_for_routing\n' + mandatory)
    const r = spawnSync(process.execPath, [join(LIB, 'context-pack.mjs'), '--root', root, '--req', 'demo-req', '--budget', 'brief'], { encoding: 'utf8' })
    assert.equal(r.status, 1, r.stderr)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /budget|예산/)
    assert.throws(() => buildPack({ root, reqSlug: 'demo-req', budget: 'brief' }), /budget|예산/)
  }
})

test('확정 사실과 검증 기록의 시크릿도 예산 판단 전에 scrub한다', (t) => {
  const root = makeFixture(t)
  const secret = 'sk-ant-' + 'a'.repeat(6000)
  writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), [
    'metadata:', '  req_id: demo-req', '  status: ready_for_routing',
    'requirement:', '  confirmed_facts:', `    - ${secret}`,
    'verification:', '  attempts:', `    - evidence: ${secret}`, '  evidence:', `    - artifact: ${secret}`,
  ].join('\n'))
  const pack = buildPack({ root, reqSlug: 'demo-req', budget: 'brief' })
  assert.doesNotMatch(pack, /sk-ant-/)
  assert.equal(pack.match(/\[REDACTED_ANTHROPIC_KEY\]/g)?.length, 3)
})

test('REQ 파일명과 metadata.req_id의 불일치나 누락을 명시·자동 선택 모두 거절한다', (t) => {
  const root = makeFixture(t)
  for (const reqId of ['', '  req_id: other-req', '  req_id: ""']) {
    writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), `metadata:\n${reqId}\n  status: ready_for_routing\n`)
    for (const selection of [{ reqSlug: 'demo-req' }, {}]) {
      assert.throws(() => buildPack({ root, ...selection }), /req_id/)
    }
  }
})

test('알 수 없거나 누락한 REQ 상태를 명시·자동 선택 모두 거절한다', (t) => {
  const root = makeFixture(t)
  for (const status of ['', '  status: paused', '  status: ""']) {
    writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), `metadata:\n  req_id: demo-req\n${status}\n`)
    for (const selection of [{ reqSlug: 'demo-req' }, {}]) {
      assert.throws(() => buildPack({ root, ...selection }), /status/)
    }
  }
})

test('네 가지 상태와 따옴표 ID는 명시 선택하고 자동 선택은 verified를 제외한다', (t) => {
  const root = makeFixture(t)
  for (const status of ['needs_intake', 'needs_clarification', 'ready_for_routing', 'verified']) {
    writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), `metadata:\n  req_id: 'demo-req' # filename\n  status: "${status}" # known status\nrequirement:\n  user_intent: 선택한 REQ의 목표\n`)
    assert.match(buildPack({ root, reqSlug: 'demo-req' }), /선택한 REQ의 목표/)
    const automatic = buildPack({ root })
    if (status === 'verified') assert.doesNotMatch(automatic, /선택한 REQ의 목표/)
    else assert.match(automatic, /선택한 REQ의 목표/)
  }
})

test('새 필수 필드도 지원하지 않는 mapping과 alias를 거절한다', (t) => {
  const root = makeFixture(t)
  for (const yaml of [
    'requirement:\n  confirmed_facts: *facts',
    'requirement: {confirmed_facts: [확정]}',
    'verification: {commands: [node --test]}',
    'verification: *previous',
    'verification:\n  commands: []\nverification:\n  commands: [node --test]',
  ]) {
    writeFileSync(join(root, '.harness/reqs/demo-req.yaml'), 'metadata:\n  req_id: demo-req\n  status: ready_for_routing\n' + yaml)
    assert.throws(() => buildPack({ root, reqSlug: 'demo-req' }), /mapping|alias|중복/)
  }
})
