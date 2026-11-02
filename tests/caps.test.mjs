import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCaps, NEW_FILE_CAP } from '../lib/caps.mjs'

// §4.6: 캡은 둘이다 — 기존 파일은 "현행 최대+여유"(대량 red 방지),
// 신규 파일만 엄격 캡(314). 하나로 합치면 어느 한쪽이 무의미해진다.

test('기존 파일 캡 = 현행 최대 + 10% 여유 (올림)', () => {
  const caps = computeCaps([10, 50, 100])
  assert.equal(caps.max, 100)
  assert.equal(caps.p50, 50)
  assert.equal(caps.existingCap, 110)
})

test('신규 파일 캡은 리포 크기와 무관하게 314 고정', () => {
  assert.equal(computeCaps([20, 30]).newFileCap, NEW_FILE_CAP)
  assert.equal(computeCaps([10, 800]).newFileCap, NEW_FILE_CAP)
})

test('빈 입력(그린필드): existingCap 0, newFileCap만 유효', () => {
  const caps = computeCaps([])
  assert.equal(caps.existingCap, 0)
  assert.equal(caps.newFileCap, NEW_FILE_CAP)
  assert.equal(caps.max, 0)
})

test('첫 verify 대량 red 방지 — 기존 800줄 파일 위에 캡이 선다 (§4.6)', () => {
  assert.ok(computeCaps([100, 800]).existingCap >= 800)
})
