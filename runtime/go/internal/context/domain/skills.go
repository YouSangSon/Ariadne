package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type Selection struct{ ID, SHA256 string }
type Metadata struct {
	Name        string
	Description Text
}

var skillSlug = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var selectionSHA = regexp.MustCompile(`^[a-f0-9]{64}$`)

func SkillSelection(value string) (Selection, error) {
	parts := strings.Split(value, "@")
	if len(parts) != 2 || len(parts[0]) > 64 || !skillSlug.MatchString(parts[0]) || !selectionSHA.MatchString(parts[1]) {
		return Selection{}, errors.New("skill selection requires slug@SHA256")
	}
	return Selection{ID: parts[0], SHA256: parts[1]}, nil
}

// quotedScalar uses stdlib only for isolated JSON string syntax. The decoded value
// comes from the original code units so escaped or literal lone surrogates survive.
func quotedScalar(value Text) (Text, bool) {
	syntax := make([]rune, value.Len())
	for i, c := range value.units {
		syntax[i] = rune(c)
	}
	if !json.Valid([]byte(string(syntax))) {
		return Text{}, false
	}
	var decoded []uint16
	for i := 1; i < value.Len()-1; i++ {
		c := value.units[i]
		if c != '\\' {
			decoded = append(decoded, c)
			continue
		}
		i++
		switch value.units[i] {
		case '"', '\\', '/':
			decoded = append(decoded, value.units[i])
		case 'b':
			decoded = append(decoded, 8)
		case 'f':
			decoded = append(decoded, 12)
		case 'n':
			decoded = append(decoded, 10)
		case 'r':
			decoded = append(decoded, 13)
		case 't':
			decoded = append(decoded, 9)
		case 'u':
			var unit uint16
			for n := 0; n < 4; n++ {
				i++
				v := value.units[i]
				switch {
				case v >= '0' && v <= '9':
					v -= '0'
				case v >= 'a' && v <= 'f':
					v = v - 'a' + 10
				default:
					v = v - 'A' + 10
				}
				unit = unit*16 + v
			}
			decoded = append(decoded, unit)
		}
	}
	return Text{decoded}, true
}
func singleQuoted(value Text) (Text, bool) {
	if value.Len() < 2 || value.units[value.Len()-1] != '\'' {
		return Text{}, false
	}
	var u []uint16
	for i := 1; i < value.Len()-1; i++ {
		c := value.units[i]
		if c == '\'' {
			if i+1 >= value.Len()-1 || value.units[i+1] != '\'' {
				return Text{}, false
			}
			i++
		}
		u = append(u, c)
	}
	return Text{u}, true
}
func normalizeMetadataLines(text Text) []Text {
	var u []uint16
	for i, c := range text.units {
		if c == 13 && i+1 < text.Len() && text.units[i+1] == 10 {
			continue
		}
		u = append(u, c)
	}
	return (Text{u}).splitLF()
}
func SkillMetadata(id string, source Text) (Metadata, error) {
	if len(id) > 64 || !skillSlug.MatchString(id) {
		return Metadata{}, errors.New("invalid skill directory name")
	}
	lines := normalizeMetadataLines(source)
	end := -1
	for i := 1; i < len(lines); i++ {
		if lines[i].equal(FromString("---")) {
			end = i
			break
		}
	}
	if !lines[0].equal(FromString("---")) || end < 0 {
		return Metadata{}, errors.New("skill frontmatter required")
	}
	values := make([]Text, 2)
	for ki, key := range []string{"name", "description"} {
		match := -1
		for i := 1; i < end; i++ {
			if lines[i].starts(key + ":") {
				if match >= 0 {
					return Metadata{}, fmt.Errorf("skill requires exactly one %s", key)
				}
				match = i
			}
		}
		if match < 0 {
			return Metadata{}, fmt.Errorf("skill requires exactly one %s", key)
		}
		value := (Text{lines[match].units[len(key)+1:]}).trim()
		if value.starts("\"") {
			var ok bool
			value, ok = quotedScalar(value)
			if !ok {
				return Metadata{}, fmt.Errorf("skill %s: invalid quoted scalar", key)
			}
		} else if value.starts("'") {
			var ok bool
			value, ok = singleQuoted(value)
			if !ok {
				return Metadata{}, fmt.Errorf("skill %s: invalid quoted scalar", key)
			}
		} else {
			unsupported := false
			if value.Len() > 0 {
				switch value.units[0] {
				case '!', '&', '*', '|', '>', '[', ']', '{', '}', '#':
					unsupported = true
				}
			}
			for i := 1; i < value.Len(); i++ {
				if value.units[i] == '#' && esSpace(value.units[i-1]) {
					unsupported = true
				}
			}
			if unsupported {
				return Metadata{}, fmt.Errorf("skill %s: only single-line plain or quoted scalars are supported", key)
			}
		}
		next := match + 1
		for next < end && (lines[next].trim().Len() == 0 || lines[next].trimStart().starts("#")) {
			next++
		}
		if next < end && lines[next].Len() > 0 && esSpace(lines[next].units[0]) && lines[next].trimStart().Len() > 0 {
			return Metadata{}, fmt.Errorf("skill %s: multiline scalars are unsupported", key)
		}
		invalid := value.trim().Len() == 0
		for _, c := range value.units {
			if c <= 31 || c == 127 {
				invalid = true
			}
		}
		if invalid {
			return Metadata{}, fmt.Errorf("invalid skill %s", key)
		}
		values[ki] = value
	}
	if !values[0].equal(FromString(id)) || values[1].Len() > 1024 {
		return Metadata{}, errors.New("skill name must match directory; description limit is 1024 characters")
	}
	return Metadata{Name: id, Description: values[1]}, nil
}
