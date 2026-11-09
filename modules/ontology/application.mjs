import { reviewStatus, searchTerms, validateDefinition } from './domain.mjs'

// Ports return authored JSON, source SHA-256 values, and a SHA-256 of UTF-8 text.
export function loadOntology({ readDocument, readSource, hash }) {
  const { reviewed_digest, ...definition } = validateDefinition(readDocument())
  const paths = [...new Set([...definition.terms, ...definition.relations].flatMap((item) => item.sources))].sort()
  if (paths.length > 32) throw new Error('Ontology exceeds 32 unique source files')
  const source_hashes = paths.map((path) => ({ path, sha256: readSource(path) }))
  const digest = hash(JSON.stringify({ fingerprint_version: 1, definition, source_hashes }))
  return { ...definition, source_hashes, digest, review_status: reviewStatus(reviewed_digest, digest) }
}

export function inspectOntology(snapshot) {
  return {
    schema_version: 1, digest: snapshot.digest, review_status: snapshot.review_status,
    term_count: snapshot.terms.length, relation_count: snapshot.relations.length,
    terms_without_sources: snapshot.terms.filter((term) => !term.sources.length).length,
    relations_without_sources: snapshot.relations.filter((relation) => !relation.sources.length).length,
    source_hashes: snapshot.source_hashes,
  }
}

export function searchOntology(snapshot, query, limit) {
  const result = searchTerms(snapshot, query, limit)
  const paths = new Set([...result.terms, ...result.relations].flatMap((item) => item.sources))
  return {
    schema_version: 1, digest: snapshot.digest, review_status: snapshot.review_status, ...result,
    source_hashes: snapshot.source_hashes.filter((source) => paths.has(source.path)),
  }
}
