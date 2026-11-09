// shortcut: REQ 템플릿의 2칸 들여쓰기 mapping만 지원하며 YAML 의미 해석이 필요해지면 정식 파서를 쓴다.
export function fieldBlock(yaml, path) {
  let lines = yaml.split('\n')
  for (const [depth, key] of path.entries()) {
    const prefix = '  '.repeat(depth)
    const matches = lines.flatMap((line, i) => line.startsWith(`${prefix}${key}:`) ? [i] : [])
    if (matches.length > 1) throw new Error(`REQ ${path.join('.')}: 중복 필드`)
    if (!matches.length) {
      if (lines.some((line) => new RegExp(`^\\s*(?:\\?\\s*)?["']?${key}["']?\\s*(?::|$)`).test(line))) throw new Error(`REQ ${key}: 템플릿의 2칸 들여쓰기 mapping이 필요하다`)
      return ''
    }
    const start = matches[0]
    let end = start + 1
    while (end < lines.length && (!lines[end].trim() || lines[end].trimStart().startsWith('#') || lines[end].search(/\S/) > prefix.length)) end++
    lines = lines.slice(start, end)
    if (/(?:^|[\s\[,])[*&][A-Za-z0-9_-]+/m.test(lines.join('\n'))) throw new Error(`REQ ${path.join('.')}: YAML alias/anchor는 지원하지 않는다`)
    if ((depth < path.length - 1 || ['metadata', 'requirement', 'functional_contract', 'code_mapping', 'audit', 'clarification', 'verification'].includes(key)) && !new RegExp(`^${prefix}${key}:\\s*(?:#.*)?$`).test(lines[0])) {
      throw new Error(`REQ ${key}: 템플릿의 block mapping이 필요하다`)
    }
    if (depth < path.length - 1 || key === 'verification') {
      const children = lines.slice(1).filter((line) => line.trim() && !line.trimStart().startsWith('#'))
      if ((children.length && children[0].search(/\S/) !== prefix.length + 2) || children.some((line) => line.search(/\S/) === prefix.length + 2 && !/^\s*[a-z_][a-z0-9_]*:/.test(line))) {
        throw new Error(`REQ ${key}: 템플릿의 plain mapping key와 2칸 들여쓰기가 필요하다`)
      }
    }
  }
  return lines.join('\n').trimEnd()
}
