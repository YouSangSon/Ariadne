package ontology

import (
	"errors"
	"math"
	"sort"
)

// Limit distinguishes omission from an authored null or other invalid value.
type Limit struct {
	Present bool
	Value   any
}
type SearchResult struct {
	Query              Text       `json:"query"`
	TotalMatches       int        `json:"total_matches"`
	Ambiguous          bool       `json:"ambiguous"`
	Truncated          bool       `json:"truncated"`
	Terms              []Term     `json:"terms"`
	Relations          []Relation `json:"relations"`
	TotalRelations     int        `json:"total_relations"`
	RelationsTruncated bool       `json:"relations_truncated"`
}

func SearchTerms(definition Definition, query any, option Limit) (SearchResult, error) {
	text, err := validText(query, 256, "query")
	if err != nil {
		return SearchResult{}, err
	}
	normalized := Normalize(text.Trim())
	limit := 5
	if option.Present {
		number, ok := option.Value.(float64)
		if !ok || math.Trunc(number) != number || number < 1 || number > 20 || math.IsNaN(number) {
			return SearchResult{}, errors.New("limit must be an integer from 1 to 20")
		}
		limit = int(number)
	}
	type match struct {
		term  Term
		score int
	}
	matches := []match{}
	exactCount := 0
	for _, term := range definition.Terms {
		score := 0
		labels := append([]Text{term.ID, term.Name}, term.Synonyms...)
		for _, label := range labels {
			label = Normalize(label)
			if label.Equal(normalized) {
				score = 3
				break
			}
			if label.Includes(normalized) {
				score = 2
			}
		}
		if score == 0 && Normalize(term.Description).Includes(normalized) {
			score = 1
		}
		if score == 3 {
			exactCount++
		}
		if score > 0 {
			matches = append(matches, match{term, score})
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].term.ID.Compare(matches[j].term.ID) < 0
	})
	result := SearchResult{Query: text, TotalMatches: len(matches), Ambiguous: exactCount > 1, Truncated: len(matches) > limit, Terms: []Term{}, Relations: []Relation{}}
	ids := map[string]bool{}
	for i, m := range matches {
		if i == limit {
			break
		}
		result.Terms = append(result.Terms, m.term)
		ids[m.term.ID.Key()] = true
	}
	for _, relation := range definition.Relations {
		if ids[relation.From.Key()] || ids[relation.To.Key()] {
			result.TotalRelations++
			if len(result.Relations) < limit {
				result.Relations = append(result.Relations, relation)
			}
		}
	}
	result.RelationsTruncated = result.TotalRelations > limit
	return result, nil
}
