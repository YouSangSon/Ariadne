// 브라운필드 캡 산정 (§4.6) — 캡은 둘: 기존 파일(현행 최대+여유)과 신규 파일(314 엄격).
// 합치지 않는다 — 첫 verify 대량 red 방지와 신규 코드 규율은 다른 문제다.
export const NEW_FILE_CAP = 314 // atlas-code 수치 — 신규 파일 기본값
const MARGIN_PCT = 10 // 정수 연산 — 100*1.1의 부동소수 오차(→111) 방지

export function computeCaps(lineCounts) {
  const sorted = [...lineCounts].sort((a, b) => a - b)
  const max = sorted.at(-1) ?? 0
  const p50 = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0
  return { max, p50, existingCap: Math.ceil((max * (100 + MARGIN_PCT)) / 100), newFileCap: NEW_FILE_CAP }
}
