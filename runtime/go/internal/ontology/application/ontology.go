package ontologyapp

import (
	ontology "ariadne/runtime/internal/ontology/domain"
	"errors"
	"sort"
)

type SourceHash struct {
	Path   ontology.Text `json:"path"`
	SHA256 string        `json:"sha256"`
}
type FingerprintPayload struct {
	Definition   ontology.Definition
	SourceHashes []SourceHash
}
type Ports struct {
	ReadDocument func() (any, error)
	ReadSource   func(ontology.Text) (string, error)
	Fingerprint  func(FingerprintPayload) string
}
type Snapshot struct {
	Definition   ontology.Definition
	SourceHashes []SourceHash
	Digest       string
	ReviewStatus string
}
type Inspection struct {
	SchemaVersion           int          `json:"schema_version"`
	Digest                  string       `json:"digest"`
	ReviewStatus            string       `json:"review_status"`
	TermCount               int          `json:"term_count"`
	RelationCount           int          `json:"relation_count"`
	TermsWithoutSources     int          `json:"terms_without_sources"`
	RelationsWithoutSources int          `json:"relations_without_sources"`
	SourceHashes            []SourceHash `json:"source_hashes"`
}
type SearchResult struct {
	SchemaVersion int    `json:"schema_version"`
	Digest        string `json:"digest"`
	ReviewStatus  string `json:"review_status"`
	ontology.SearchResult
	SourceHashes []SourceHash `json:"source_hashes"`
}

func LoadOntology(ports Ports) (Snapshot, error) {
	input, err := ports.ReadDocument()
	if err != nil {
		return Snapshot{}, err
	}
	definition, err := ontology.ValidateDefinition(input)
	if err != nil {
		return Snapshot{}, err
	}
	recorded := definition.ReviewedDigest
	definition.ReviewedDigest = nil
	paths := map[string]ontology.Text{}
	for _, term := range definition.Terms {
		for _, path := range term.Sources {
			paths[path.Key()] = path
		}
	}
	for _, relation := range definition.Relations {
		for _, path := range relation.Sources {
			paths[path.Key()] = path
		}
	}
	if len(paths) > 32 {
		return Snapshot{}, errors.New("Ontology exceeds 32 unique source files")
	}
	ordered := make([]ontology.Text, 0, len(paths))
	for _, path := range paths {
		ordered = append(ordered, path)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Compare(ordered[j]) < 0 })
	hashes := []SourceHash{}
	for _, path := range ordered {
		hash, err := ports.ReadSource(path)
		if err != nil {
			return Snapshot{}, err
		}
		hashes = append(hashes, SourceHash{path, hash})
	}
	digest := ports.Fingerprint(FingerprintPayload{definition, hashes})
	return Snapshot{definition, hashes, digest, ontology.ReviewStatus(recorded, digest)}, nil
}
func InspectOntology(snapshot Snapshot) Inspection {
	result := Inspection{SchemaVersion: 1, Digest: snapshot.Digest, ReviewStatus: snapshot.ReviewStatus, TermCount: len(snapshot.Definition.Terms), RelationCount: len(snapshot.Definition.Relations), SourceHashes: snapshot.SourceHashes}
	for _, term := range snapshot.Definition.Terms {
		if len(term.Sources) == 0 {
			result.TermsWithoutSources++
		}
	}
	for _, relation := range snapshot.Definition.Relations {
		if len(relation.Sources) == 0 {
			result.RelationsWithoutSources++
		}
	}
	return result
}
func SearchOntology(snapshot Snapshot, query any, limit ontology.Limit) (SearchResult, error) {
	result, err := ontology.SearchTerms(snapshot.Definition, query, limit)
	if err != nil {
		return SearchResult{}, err
	}
	paths := map[string]bool{}
	for _, term := range result.Terms {
		for _, path := range term.Sources {
			paths[path.Key()] = true
		}
	}
	for _, relation := range result.Relations {
		for _, path := range relation.Sources {
			paths[path.Key()] = true
		}
	}
	hashes := []SourceHash{}
	for _, source := range snapshot.SourceHashes {
		if paths[source.Path.Key()] {
			hashes = append(hashes, source)
		}
	}
	return SearchResult{1, snapshot.Digest, snapshot.ReviewStatus, result, hashes}, nil
}
