import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrub, detect, PATTERNS } from '../lib/scrub.mjs'

// 카테고리별 대표 시크릿 — 전부 합성 값
const SAMPLES = {
  'anthropic-key': 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'openai-key': 'sk-proj4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'stripe-key': 'sk_live_' + 'a'.repeat(24),
  'github-token': 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'slack-token': 'xoxb-1111111111-2222222222-abcdefghij',
  'aws-access-key': 'AKIAIOSFODNN7EXAMPLE',
  'aws-secret-key': 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY1234',
  'gcp-api-key': 'AIzaSyA-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'npm-token': 'npm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaaaa',
  'bearer-token': 'Bearer abcdefghijklmnopqrstuvwxyz012345',
  'db-url': 'postgresql://admin:hunter2secret@db.internal:5432/app',
  'private-key': '-----BEGIN RSA PRIVATE KEY-----\nMIIEaaaa\n-----END RSA PRIVATE KEY-----',
}

test('전 카테고리(13)가 PATTERNS에 존재한다', () => {
  const cats = PATTERNS.map((p) => p.category)
  assert.deepEqual(new Set(cats).size, cats.length, '카테고리 중복')
  for (const c of Object.keys(SAMPLES)) assert.ok(cats.includes(c), `${c} 패턴 없음`)
})

for (const [category, sample] of Object.entries(SAMPLES)) {
  test(`검출·치환: ${category} — 값은 절대 출력에 남지 않는다`, () => {
    const input = `앞텍스트 ${sample} 뒤텍스트`
    const { text, detections } = scrub(input)
    assert.ok(detections.includes(category), `미검출: ${detections}`)
    // 시크릿 본체(프리픽스 뒤 무작위부)가 출력에 없어야 한다
    const core = sample.replace(/^Bearer\s+/, '').replace(/^AWS_SECRET_ACCESS_KEY=/, '')
    assert.ok(!text.includes(core), `값 유출: ${text}`)
    assert.match(text, /\[REDACTED_/)
    assert.ok(text.startsWith('앞텍스트'), '주변 텍스트 훼손')
  })
}

test('순서: sk-ant는 anthropic으로, openai로 오분류되지 않는다', () => {
  const { detections } = scrub(SAMPLES['anthropic-key'])
  assert.ok(detections.includes('anthropic-key'))
  assert.ok(!detections.includes('openai-key'))
})

test('순서: 헤더 없는 JWT도 jwt로 잡힌다 (Bearer보다 먼저)', () => {
  const { detections } = scrub(`token=${SAMPLES.jwt}`)
  assert.ok(detections.includes('jwt'))
})

test('오탐 경로: 유사 무해 문자열은 통과하고 텍스트가 변하지 않는다', () => {
  const benign = [
    'sk-short',
    'risk-free 분석입니다',
    'npm install 하세요',
    'https://example.com/path (userinfo 없는 URL)',
    'AKIA는 AWS 키 프리픽스다', // 16자 대문자 미충족
  ].join('\n')
  const { text, detections } = scrub(benign)
  assert.deepEqual(detections, [])
  assert.equal(text, benign)
})

test('반환 구조: 거부가 아니라 {text, detections} 치환+advisory', () => {
  const r = scrub(`a ${SAMPLES['github-token']} b ${SAMPLES['slack-token']} c`)
  assert.ok(typeof r.text === 'string')
  assert.ok(Array.isArray(r.detections))
  assert.deepEqual([...r.detections].sort(), ['github-token', 'slack-token'])
})

test('detect: 치환 없이 카테고리만 (strict 콜사이트용)', () => {
  const cats = detect(SAMPLES['db-url'])
  assert.deepEqual(cats, ['db-url'])
})
