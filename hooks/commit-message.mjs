// PreToolUse(Bash) — 커밋 불변식 조기경보 (§4.3.1). 최종 강제선은 verify+CI다
import { readStdinJson, rootFromArgs, claudeExit, audit } from './hook-io.mjs'

import { checkCommitCommand } from '../core/domain/commit.mjs'
export { checkCommitCommand } from '../core/domain/commit.mjs'

const root = rootFromArgs(process.argv)
const input = readStdinJson()
if (!input) {
  audit(root, 'commit-message', 'pass', 'malformed-stdin fail-open')
  process.exit(0)
}
claudeExit(root, 'commit-message', checkCommitCommand(input.tool_input?.command ?? ''))
