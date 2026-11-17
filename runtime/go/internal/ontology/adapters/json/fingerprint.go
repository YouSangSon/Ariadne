package ontologyjson

import (
	ontologyapp "ariadne/runtime/internal/ontology/application"
	ontology "ariadne/runtime/internal/ontology/domain"
	"crypto/sha256"
	"encoding/hex"
)

func textList(values []ontology.Text) []byte {
	out := []byte{'['}
	for i, value := range values {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, Quote(value)...)
	}
	return append(out, ']')
}

// FingerprintBytes encodes the fixed typed payload, never normalized authored text.
func FingerprintBytes(payload ontologyapp.FingerprintPayload) []byte {
	out := []byte(`{"fingerprint_version":1,"definition":{"schema_version":1,"terms":[`)
	for i, term := range payload.Definition.Terms {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, `{"id":`...)
		out = append(out, Quote(term.ID)...)
		out = append(out, `,"name":`...)
		out = append(out, Quote(term.Name)...)
		out = append(out, `,"description":`...)
		out = append(out, Quote(term.Description)...)
		out = append(out, `,"synonyms":`...)
		out = append(out, textList(term.Synonyms)...)
		out = append(out, `,"sources":`...)
		out = append(out, textList(term.Sources)...)
		out = append(out, '}')
	}
	out = append(out, `],"relations":[`...)
	for i, relation := range payload.Definition.Relations {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, `{"from":`...)
		out = append(out, Quote(relation.From)...)
		out = append(out, `,"type":`...)
		out = append(out, Quote(relation.Type)...)
		out = append(out, `,"to":`...)
		out = append(out, Quote(relation.To)...)
		out = append(out, `,"sources":`...)
		out = append(out, textList(relation.Sources)...)
		out = append(out, '}')
	}
	out = append(out, `]},"source_hashes":[`...)
	for i, source := range payload.SourceHashes {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, `{"path":`...)
		out = append(out, Quote(source.Path)...)
		out = append(out, `,"sha256":`...)
		out = append(out, Quote(ontology.FromString(source.SHA256))...)
		out = append(out, '}')
	}
	return append(out, ']', '}')
}
func Fingerprint(payload ontologyapp.FingerprintPayload) string {
	sum := sha256.Sum256(FingerprintBytes(payload))
	return hex.EncodeToString(sum[:])
}
