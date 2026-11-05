import { detect } from '../../lib/scrub.mjs'

const normalize = (value) => value.normalize('NFKC').toLowerCase()

function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => ![...required, ...optional].includes(key))) {
    throw new Error(`Expected fields: ${required.join(', ')}${optional.length ? `; optional: ${optional.join(', ')}` : ''}`)
  }
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) || detect(value).length) throw new Error('Invalid or secret-shaped identifier')
  return value
}
function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}; maximum ${max}`)
  return value
}
function sources(value) {
  const paths = list(value, 32, 'sources').map((path) => {
    text(path, 512, 'source path')
    if (detect(path).length || path.includes('\\') || /^[A-Za-z]:/.test(path)
      || /[\t\n\r]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Source must be a contained, non-secret relative path')
    return path
  })
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate source path')
  return paths
}

export function validateDefinition(input) {
  fields(input, ['schema_version', 'terms', 'relations'], ['reviewed_digest'])
  if (input.schema_version !== 1) throw new Error('Unsupported ontology schema_version')
  if (input.reviewed_digest !== undefined && (typeof input.reviewed_digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.reviewed_digest))) throw new Error('reviewed_digest must be a SHA-256 digest')
  const ids = new Set()
  const terms = list(input.terms, 1000, 'terms').map((term) => {
    fields(term, ['id', 'name', 'description', 'synonyms', 'sources'])
    const id = identifier(term.id)
    if (ids.has(id)) throw new Error(`Duplicate term ID: ${id}`)
    ids.add(id)
    const synonyms = list(term.synonyms, 10, 'synonyms').map((name) => text(name, 200, 'synonym'))
    if (new Set(synonyms.map(normalize)).size !== synonyms.length) throw new Error(`Duplicate synonym: ${id}`)
    return { id, name: text(term.name, 200, 'name'), description: text(term.description, 2000, 'description'), synonyms, sources: sources(term.sources) }
  })
  const edges = new Set()
  const relations = list(input.relations, 5000, 'relations').map((relation) => {
    fields(relation, ['from', 'type', 'to', 'sources'])
    const from = identifier(relation.from), type = identifier(relation.type), to = identifier(relation.to)
    if (!ids.has(from) || !ids.has(to)) throw new Error('Relation refers to an unknown term')
    const key = JSON.stringify([from, type, to])
    if (edges.has(key)) throw new Error('Duplicate relation')
    edges.add(key)
    return { from, type, to, sources: sources(relation.sources) }
  })
  return { schema_version: 1, terms, relations, ...(input.reviewed_digest === undefined ? {} : { reviewed_digest: input.reviewed_digest }) }
}

export function reviewStatus(recorded, current) {
  return recorded === undefined ? 'unreviewed' : recorded === current ? 'current' : 'stale'
}

export function searchTerms(snapshot, query, limit = 5) {
  const normalized = normalize(text(query, 256, 'query').trim())
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be an integer from 1 to 20')
  const matches = snapshot.terms.flatMap((term) => {
    const labels = [term.id, term.name, ...term.synonyms].map(normalize)
    const exact = labels.includes(normalized)
    const score = exact ? 3 : labels.some((label) => label.includes(normalized)) ? 2 : normalize(term.description).includes(normalized) ? 1 : 0
    return score ? [{ term, score }] : []
  }).sort((a, b) => b.score - a.score || (a.term.id < b.term.id ? -1 : a.term.id > b.term.id ? 1 : 0))
  const terms = matches.slice(0, limit).map(({ term }) => term)
  const ids = new Set(terms.map((term) => term.id))
  const relations = snapshot.relations.filter((relation) => ids.has(relation.from) || ids.has(relation.to))
  return {
    query, total_matches: matches.length, ambiguous: matches.filter((match) => match.score === 3).length > 1,
    truncated: matches.length > limit, terms, relations: relations.slice(0, limit),
    total_relations: relations.length, relations_truncated: relations.length > limit,
  }
}
