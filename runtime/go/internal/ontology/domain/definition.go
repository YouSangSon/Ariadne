package ontology

import (
	"ariadne/runtime/internal/core/domain/scrub"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type Term struct {
	ID          Text   `json:"id"`
	Name        Text   `json:"name"`
	Description Text   `json:"description"`
	Synonyms    []Text `json:"synonyms"`
	Sources     []Text `json:"sources"`
}
type Relation struct {
	From    Text   `json:"from"`
	Type    Text   `json:"type"`
	To      Text   `json:"to"`
	Sources []Text `json:"sources"`
}
type Definition struct {
	SchemaVersion  int        `json:"schema_version"`
	Terms          []Term     `json:"terms"`
	Relations      []Relation `json:"relations"`
	ReviewedDigest *Text      `json:"reviewed_digest,omitempty"`
}

var identifierPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func fields(value any, required, optional []string) (map[string]any, error) {
	object, ok := value.(map[string]any)
	valid := ok
	for _, key := range required {
		if _, exists := object[key]; !exists {
			valid = false
		}
	}
	for key := range object {
		found := false
		for _, allowed := range append(append([]string{}, required...), optional...) {
			if key == allowed {
				found = true
				break
			}
		}
		if !found {
			valid = false
		}
	}
	if !valid {
		message := "Expected fields: " + strings.Join(required, ", ")
		if len(optional) > 0 {
			message += "; optional: " + strings.Join(optional, ", ")
		}
		return nil, errors.New(message)
	}
	return object, nil
}
func validText(value any, max int, label string) (Text, error) {
	text, ok := value.(Text)
	if !ok || text.Trim().Len() == 0 || text.Len() > max || text.hasControl() {
		return Text{}, fmt.Errorf("Invalid %s", label)
	}
	return text, nil
}
func identifier(value any) (Text, error) {
	text, ok := value.(Text)
	if !ok || !identifierPattern.MatchString(text.String()) || len(scrub.Detect(text.units)) > 0 {
		return Text{}, errors.New("Invalid or secret-shaped identifier")
	}
	return text, nil
}
func list(value any, max int, label string) ([]any, error) {
	values, ok := value.([]any)
	if !ok || len(values) > max {
		return nil, fmt.Errorf("Invalid %s; maximum %d", label, max)
	}
	return values, nil
}
func sources(value any) ([]Text, error) {
	values, err := list(value, 32, "sources")
	if err != nil {
		return nil, err
	}
	paths := []Text{}
	seen := map[string]bool{}
	for _, value := range values {
		text, err := validText(value, 512, "source path")
		if err != nil {
			return nil, err
		}
		s := text.String()
		invalid := len(scrub.Detect(text.units)) > 0 || strings.ContainsAny(s, "\\\t\n\r") || len(s) >= 2 && ((s[0] >= 'A' && s[0] <= 'Z') || (s[0] >= 'a' && s[0] <= 'z')) && s[1] == ':'
		for _, part := range strings.Split(s, "/") {
			if part == "" || part == "." || part == ".." {
				invalid = true
			}
		}
		if invalid {
			return nil, errors.New("Source must be a contained, non-secret relative path")
		}
		paths = append(paths, text)
		seen[text.Key()] = true
	}
	if len(seen) != len(paths) {
		return nil, errors.New("Duplicate source path")
	}
	return paths, nil
}
func ValidateDefinition(input any) (Definition, error) {
	object, err := fields(input, []string{"schema_version", "terms", "relations"}, []string{"reviewed_digest"})
	if err != nil {
		return Definition{}, err
	}
	if version, ok := object["schema_version"].(float64); !ok || version != 1 {
		return Definition{}, errors.New("Unsupported ontology schema_version")
	}
	definition := Definition{SchemaVersion: 1, Terms: []Term{}, Relations: []Relation{}}
	if value, exists := object["reviewed_digest"]; exists {
		text, ok := value.(Text)
		if !ok || !digestPattern.MatchString(text.String()) {
			return Definition{}, errors.New("reviewed_digest must be a SHA-256 digest")
		}
		definition.ReviewedDigest = &text
	}
	terms, err := list(object["terms"], 1000, "terms")
	if err != nil {
		return Definition{}, err
	}
	ids := map[string]bool{}
	for _, value := range terms {
		term, err := fields(value, []string{"id", "name", "description", "synonyms", "sources"}, nil)
		if err != nil {
			return Definition{}, err
		}
		id, err := identifier(term["id"])
		if err != nil {
			return Definition{}, err
		}
		if ids[id.Key()] {
			return Definition{}, fmt.Errorf("Duplicate term ID: %s", id.String())
		}
		ids[id.Key()] = true
		synonyms, err := list(term["synonyms"], 10, "synonyms")
		if err != nil {
			return Definition{}, err
		}
		names := []Text{}
		normalized := map[string]bool{}
		for _, value := range synonyms {
			text, err := validText(value, 200, "synonym")
			if err != nil {
				return Definition{}, err
			}
			names = append(names, text)
			normalized[Normalize(text).Key()] = true
		}
		if len(normalized) != len(names) {
			return Definition{}, fmt.Errorf("Duplicate synonym: %s", id.String())
		}
		name, err := validText(term["name"], 200, "name")
		if err != nil {
			return Definition{}, err
		}
		description, err := validText(term["description"], 2000, "description")
		if err != nil {
			return Definition{}, err
		}
		paths, err := sources(term["sources"])
		if err != nil {
			return Definition{}, err
		}
		definition.Terms = append(definition.Terms, Term{id, name, description, names, paths})
	}
	relations, err := list(object["relations"], 5000, "relations")
	if err != nil {
		return Definition{}, err
	}
	edges := map[[3]string]bool{}
	for _, value := range relations {
		relation, err := fields(value, []string{"from", "type", "to", "sources"}, nil)
		if err != nil {
			return Definition{}, err
		}
		from, err := identifier(relation["from"])
		if err != nil {
			return Definition{}, err
		}
		kind, err := identifier(relation["type"])
		if err != nil {
			return Definition{}, err
		}
		to, err := identifier(relation["to"])
		if err != nil {
			return Definition{}, err
		}
		if !ids[from.Key()] || !ids[to.Key()] {
			return Definition{}, errors.New("Relation refers to an unknown term")
		}
		key := [3]string{from.Key(), kind.Key(), to.Key()}
		if edges[key] {
			return Definition{}, errors.New("Duplicate relation")
		}
		edges[key] = true
		paths, err := sources(relation["sources"])
		if err != nil {
			return Definition{}, err
		}
		definition.Relations = append(definition.Relations, Relation{from, kind, to, paths})
	}
	return definition, nil
}
func ReviewStatus(recorded *Text, current string) string {
	if recorded == nil {
		return "unreviewed"
	}
	if recorded.Equal(FromString(current)) {
		return "current"
	}
	return "stale"
}
