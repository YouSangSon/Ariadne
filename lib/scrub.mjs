// 시크릿 방어 — Parallax 13 + akasha 12 패턴 합집합 (§4.5)
// 원칙: 매칭 값은 절대 반환하지 않는다 — 카테고리만. 거부가 아니라 치환+advisory.
// 순서 중요: anthropic → openai (프리픽스 포함관계), jwt → bearer (헤더 없는 JWT)

const token = (category) => `[REDACTED_${category.toUpperCase().replaceAll('-', '_')}]`

export const PATTERNS = [
  { category: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { category: 'openai-key', regex: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { category: 'stripe-key', regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { category: 'github-token', regex: /\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { category: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { category: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    category: 'aws-secret-key',
    regex: /AWS_SECRET_ACCESS_KEY\s*=\s*[A-Za-z0-9/+=]{32,}/g,
    replacement: `AWS_SECRET_ACCESS_KEY=${token('aws-secret-key')}`,
  },
  { category: 'gcp-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { category: 'npm-token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { category: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  {
    category: 'bearer-token',
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/g,
    replacement: `Bearer ${token('bearer-token')}`,
  },
  {
    category: 'db-url',
    regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/g,
  },
  {
    category: 'private-key',
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  },
]

export function scrub(input) {
  let text = input
  const detections = []
  for (const p of PATTERNS) {
    if (!p.regex.test(text)) continue
    p.regex.lastIndex = 0
    text = text.replace(p.regex, p.replacement ?? token(p.category))
    detections.push(p.category)
  }
  return { text, detections }
}

// strict 콜사이트용 — 치환 없이 카테고리만 (재생성 가능한 데이터의 전면 거부 판단에 사용)
export function detect(input) {
  return scrub(input).detections
}
