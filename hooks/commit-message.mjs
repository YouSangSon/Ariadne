// PreToolUse(Bash) — 커밋 불변식 조기경보 (§4.3.1). 최종 강제선은 verify+CI다
import { readStdinJson, rootFromArgs, claudeExit, audit } from './hook-io.mjs'

const TYPES = /^(feat|fix|refactor|docs|test|chore|perf|ci|style|build)(\(.+\))?: .+/
const REQ_LINE = /^REQ: ([a-z0-9][a-z0-9-]*|none \(.+\))$/m
const SUBJECT_MAX = 70

export function checkCommitCommand(command) {
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(command)) return { ok: true, skip: true }
  if (/--no-verify\b/.test(command)) return { ok: false, reason: '--no-verify 금지 — 우회는 CI에서 잡힌다. 훅/검사를 고치든가 사유를 REQ에 남겨라' }
  const m = command.match(/-m\s+("(?:[^"\\]|\\.)*"|'[^']*')/)
  if (!m) return { ok: true, skip: true } // -F/에디터 커밋은 verify가 검사
  const msg = m[1].slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  const subject = msg.split('\n')[0]
  if (!TYPES.test(subject)) return { ok: false, reason: `제목이 conventional 형식이 아님: "${subject}"` }
  if (subject.length > SUBJECT_MAX) return { ok: false, reason: `제목 ${subject.length}자 — ${SUBJECT_MAX}자 초과` }
  if (!REQ_LINE.test(msg)) return { ok: false, reason: '커밋 불변식: "REQ: <slug>" 또는 "REQ: none (<사유>)" 줄이 필요' }
  return { ok: true }
}

const root = rootFromArgs(process.argv)
const input = readStdinJson()
if (!input) {
  audit(root, 'commit-message', 'pass', 'malformed-stdin fail-open')
  process.exit(0)
}
claudeExit(root, 'commit-message', checkCommitCommand(input.tool_input?.command ?? ''))
