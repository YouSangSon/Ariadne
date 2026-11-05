import { detect } from '../../lib/scrub.mjs'

export const MAX_BYTES = 1024 * 1024
const BLOCKED = new Set(['.git', '.harness', '.codex', '.claude', '.gemini', '.agents', 'node_modules', '.ssh', '.aws', '.gnupg', '.netrc', '.npmrc', '.pypirc', '.mcp.json', 'agents.md', 'claude.md', 'gemini.md'])

export function projectPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || /^[A-Za-z]:/.test(path)) throw new Error('Project path is denied')
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Project path must be a contained relative path')
  if (parts.some((part) => {
    const name = part.toLowerCase()
    return BLOCKED.has(name) || name.startsWith('.env') || /(?:^|[._-])(?:credentials?|secrets?)(?:$|[._-])/.test(name) || /^(?:id_(?:rsa|dsa|ecdsa|ed25519))(?:\.|$)/.test(name) || /\.(?:pem|p12|pfx|key)$/.test(name)
  })) throw new Error('Protected project path is denied')
  return parts
}

export function validateProjectText(content) {
  if (content.includes('\0')) throw new Error('Binary project files are denied')
  return content
}

export function validateProjectWrite(content, decoded, expectedSha) {
  if (decoded !== content) throw new Error('Project content must be valid UTF-8 text')
  const categories = detect(content)
  if (categories.length) throw new Error(`Secret content is denied (${categories.join(', ')})`)
  if (expectedSha !== null && (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha))) throw new Error('expectedSha must be a SHA-256 hash or null')
}
