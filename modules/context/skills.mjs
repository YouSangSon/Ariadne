const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function skillSelection(value) {
  const [id, sha256, extra] = typeof value === 'string' ? value.split('@') : []
  if (!id || id.length > 64 || !SLUG.test(id) || !/^[a-f0-9]{64}$/.test(sha256 ?? '') || extra !== undefined) {
    throw new Error('skill selection requires slug@SHA256')
  }
  return { id, sha256 }
}

export function skillMetadata(id, text) {
  if (id.length > 64 || !SLUG.test(id)) throw new Error('invalid skill directory name')
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const end = lines.indexOf('---', 1)
  if (lines[0] !== '---' || end < 0) throw new Error('skill frontmatter required')
  const values = {}
  for (const key of ['name', 'description']) {
    const matches = lines.slice(1, end).filter((line) => line.startsWith(`${key}:`))
    if (matches.length !== 1) throw new Error(`skill requires exactly one ${key}`)
    let value = matches[0].slice(key.length + 1).trim()
    if (value.startsWith('"')) {
      try { value = JSON.parse(value) } catch { throw new Error(`skill ${key}: invalid quoted scalar`) }
    } else if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) throw new Error(`skill ${key}: invalid quoted scalar`)
      value = value.slice(1, -1).replaceAll("''", "'")
    } else if (/^[!&*|>\[\]{}#]/.test(value) || /\s#/.test(value)) {
      throw new Error(`skill ${key}: only single-line plain or quoted scalars are supported`)
    }
    let next = lines.indexOf(matches[0]) + 1
    while (next < end && (!lines[next].trim() || /^\s*#/.test(lines[next]))) next++
    if (next < end && /^\s+\S/.test(lines[next])) throw new Error(`skill ${key}: multiline scalars are unsupported`)
    if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`invalid skill ${key}`)
    values[key] = value
  }
  if (values.name !== id || values.description.length > 1024) throw new Error('skill name must match directory; description limit is 1024 characters')
  return values
}
