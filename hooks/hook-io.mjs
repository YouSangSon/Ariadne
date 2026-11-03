// 훅 공용 IO — 검사 로직 1개, 출력 어댑터 N개 원칙(§4.7)의 공유부
// 모든 훅은 fail-open이 기본(D15 — 훅은 조기경보지 강제선이 아니다)
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return null // 깨진 입력 → fail-open (호출부가 pass 처리)
  }
}

export function rootFromArgs(argv) {
  const i = argv.indexOf('--root')
  return i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd()
}

// 발화 감사(§4.12.2) — 조용한 미발화를 감지할 유일한 수단
export function audit(root, hook, decision, detail = '') {
  try {
    const p = join(root, '.harness', 'audit.jsonl')
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), hook, decision, detail }) + '\n')
  } catch {
    // 감사 실패가 훅을 죽이면 안 된다
  }
}

// Claude PreToolUse 어댑터: exit 2 = 차단(+stderr 사유), exit 0 = 통과
export function claudeExit(root, hook, verdict) {
  audit(root, hook, verdict.ok ? 'pass' : 'block', verdict.reason ?? '')
  if (!verdict.ok) {
    console.error(`${hook}: ${verdict.reason}`)
    process.exit(2)
  }
  process.exit(0)
}
