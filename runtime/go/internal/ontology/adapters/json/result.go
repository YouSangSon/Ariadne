package ontologyjson

import (
	coreapp "ariadne/runtime/internal/core/application"
	ontologyapp "ariadne/runtime/internal/ontology/application"
	ontology "ariadne/runtime/internal/ontology/domain"
	"bytes"
	"encoding/json"
	"strconv"
)

type resultWriter []byte

func (w *resultWriter) raw(s string) { *w = append(*w, s...) }
func (w *resultWriter) text(s ontology.Text) {
	*w = append(*w, Quote(ontology.NewText(coreapp.Scrub(s.Units())))...)
}
func (w *resultWriter) str(s string)   { w.text(ontology.FromString(s)) }
func (w *resultWriter) number(n int)   { w.raw(strconv.Itoa(n)) }
func (w *resultWriter) boolean(b bool) { w.raw(strconv.FormatBool(b)) }
func (w *resultWriter) texts(values []ontology.Text) {
	w.raw("[")
	for i, s := range values {
		if i > 0 {
			w.raw(",")
		}
		w.text(s)
	}
	w.raw("]")
}
func (w *resultWriter) header(digest, status string) {
	w.raw(`{"schema_version":1,"digest":`)
	w.str(digest)
	w.raw(`,"review_status":`)
	w.str(status)
}
func (w *resultWriter) sources(sources []ontologyapp.SourceHash) {
	w.raw(`,"source_hashes":[`)
	for i, s := range sources {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"path":`)
		w.text(s.Path)
		w.raw(`,"sha256":`)
		w.str(s.SHA256)
		w.raw("}")
	}
	w.raw("]}")
}
func (w *resultWriter) terms(terms []ontology.Term) {
	w.raw(`,"terms":[`)
	for i, t := range terms {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"id":`)
		w.text(t.ID)
		w.raw(`,"name":`)
		w.text(t.Name)
		w.raw(`,"description":`)
		w.text(t.Description)
		w.raw(`,"synonyms":`)
		w.texts(t.Synonyms)
		w.raw(`,"sources":`)
		w.texts(t.Sources)
		w.raw("}")
	}
	w.raw("]")
}
func (w *resultWriter) relations(relations []ontology.Relation) {
	w.raw(`,"relations":[`)
	for i, r := range relations {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"from":`)
		w.text(r.From)
		w.raw(`,"type":`)
		w.text(r.Type)
		w.raw(`,"to":`)
		w.text(r.To)
		w.raw(`,"sources":`)
		w.texts(r.Sources)
		w.raw("}")
	}
	w.raw("]")
}
func (w resultWriter) pretty() ([]byte, error) {
	var out bytes.Buffer
	if err := json.Indent(&out, w, "", "  "); err != nil {
		return nil, err
	}
	return append(out.Bytes(), '\n'), nil
}
func EncodeInspection(result ontologyapp.Inspection) ([]byte, error) {
	w := resultWriter{}
	w.header(result.Digest, result.ReviewStatus)
	w.raw(`,"term_count":`)
	w.number(result.TermCount)
	w.raw(`,"relation_count":`)
	w.number(result.RelationCount)
	w.raw(`,"terms_without_sources":`)
	w.number(result.TermsWithoutSources)
	w.raw(`,"relations_without_sources":`)
	w.number(result.RelationsWithoutSources)
	w.sources(result.SourceHashes)
	return w.pretty()
}
func EncodeSearch(result ontologyapp.SearchResult) ([]byte, error) {
	w := resultWriter{}
	w.header(result.Digest, result.ReviewStatus)
	w.raw(`,"query":`)
	w.text(result.Query)
	w.raw(`,"total_matches":`)
	w.number(result.TotalMatches)
	w.raw(`,"ambiguous":`)
	w.boolean(result.Ambiguous)
	w.raw(`,"truncated":`)
	w.boolean(result.Truncated)
	w.terms(result.Terms)
	w.relations(result.Relations)
	w.raw(`,"total_relations":`)
	w.number(result.TotalRelations)
	w.raw(`,"relations_truncated":`)
	w.boolean(result.RelationsTruncated)
	w.sources(result.SourceHashes)
	return w.pretty()
}
