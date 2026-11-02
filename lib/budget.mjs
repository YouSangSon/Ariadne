// 컨텍스트 예산 프리셋 — Parallax snippetChars 원본 수치 (§4.4)
export const PRESETS = {
  brief: { snippetChars: 300, maxChars: 4000 },
  standard: { snippetChars: 800, maxChars: 10000 },
  deep: { snippetChars: 1500, maxChars: 18000 },
}

export function normalizeBudget(value) {
  return Object.hasOwn(PRESETS, value) ? value : 'standard'
}
