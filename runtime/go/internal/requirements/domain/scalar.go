package domain

import (
	"errors"
	"regexp"
	"slices"
)

// Node non-Unicode /i must not fold long s into ASCII reserved words.
var plainValue = regexp.MustCompile(`^(?:[nN][uU][lL][lL]|~|[tT][rR][uU][eE]|[fF][aA][lL][sS][eE]|[-+]?(?:\d[\d_.]*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?\.(?:[iI][nN][fF]|[nN][aA][nN]))$`)

func scalar(head Text, continuation []Text, indent int) (Text, error) {
	value := head.trim()
	if value.starts("|") || value.starts(">") {
		end := 1
		strip := false
		if len(value.units) > end && value.units[end] == '-' {
			strip = true
			end++
		}
		if !commentTail(Text{value.units[end:]}) {
			return Text{}, errors.New("REQ unsupported multiline scalar")
		}
		lines := []Text{}
		for _, line := range continuation {
			if len(line.trim().units) == 0 {
				lines = append(lines, Text{})
				continue
			}
			if line.indent() < indent {
				return Text{}, errors.New("REQ multiline scalar indentation is unsupported")
			}
			lines = append(lines, Text{line.units[indent:]})
		}
		for len(lines) > 0 && len(lines[len(lines)-1].units) == 0 {
			lines = lines[:len(lines)-1]
		}
		var result Text
		if value.units[0] == '|' {
			result = join(lines, 10)
		} else {
			var u []uint16
			for i, line := range lines {
				u = append(u, line.units...)
				if i+1 == len(lines) {
					continue
				}
				next := lines[i+1]
				if line.starts(" ") || next.starts(" ") || len(line.units) == 0 {
					u = append(u, 10)
				} else if len(next.units) > 0 {
					u = append(u, 32)
				}
			}
			result = Text{u}
		}
		if !strip && len(lines) > 0 {
			result.units = append(result.units, 10)
		}
		return result, nil
	}
	for _, line := range continuation {
		if len(line.trim().units) > 0 && !comment(line) {
			return Text{}, errors.New("REQ unsupported scalar continuation")
		}
	}
	if value.starts("'") {
		var u []uint16
		for i := 1; i < len(value.units); i++ {
			c := value.units[i]
			if c != '\'' {
				u = append(u, c)
				continue
			}
			if i+1 < len(value.units) && value.units[i+1] == '\'' {
				u = append(u, '\'')
				i++
				continue
			}
			if commentTail(Text{value.units[i+1:]}) {
				return Text{u}, nil
			}
			break
		}
		return Text{}, errors.New("REQ unsupported quoted scalar")
	}
	if value.starts("\"") {
		end := -1
		for i := 1; i < len(value.units); i++ {
			if value.units[i] == '\\' {
				i++
				if i == len(value.units) || lineTerm(value.units[i]) {
					break
				}
				continue
			}
			if value.units[i] == '"' {
				end = i
				break
			}
		}
		if end < 0 || !commentTail(Text{value.units[end+1:]}) {
			return Text{}, errors.New("REQ unsupported quoted scalar")
		}
		return jsonString(Text{value.units[:end+1]})
	}
	plain := value
	for i, u := range value.units {
		if !space(u) {
			continue
		}
		j := i
		for j < len(value.units) && space(value.units[j]) {
			j++
		}
		if j < len(value.units) && value.units[j] == '#' && noLineTerms(Text{value.units[j:]}) {
			plain = Text{value.units[:i]}
			break
		}
	}
	plain = plain.trimEnd()
	bad := len(plain.units) == 0
	if !bad {
		first := plain.units[0]
		bad = slices.Contains([]uint16{'!', '&', '*', '[', ']', '{', '}', '|', '>', '@', '`', '"', '\'', '#'}, first) || (first == '-' || first == '?' || first == ':') && len(plain.units) > 1 && space(plain.units[1])
		for i, u := range plain.units {
			if u == ':' && (i+1 == len(plain.units) || space(plain.units[i+1])) {
				bad = true
			}
		}
	}
	if bad || plainValue.MatchString(plain.String()) {
		return Text{}, errors.New("REQ unsupported or empty string scalar")
	}
	return plain, nil
}

// jsonString decodes only a scalar's JSON string, retaining every \u code unit.
func jsonString(value Text) (Text, error) {
	var result []uint16
	fail := func() (Text, error) { return Text{}, errors.New("REQ unsupported quoted scalar escape") }
	for i := 1; i < len(value.units)-1; i++ {
		c := value.units[i]
		if c < 32 {
			return fail()
		}
		if c != '\\' {
			result = append(result, c)
			continue
		}
		i++
		if i >= len(value.units)-1 {
			return fail()
		}
		switch value.units[i] {
		case '"', '\\', '/':
			result = append(result, value.units[i])
		case 'b':
			result = append(result, 8)
		case 'f':
			result = append(result, 12)
		case 'n':
			result = append(result, 10)
		case 'r':
			result = append(result, 13)
		case 't':
			result = append(result, 9)
		case 'u':
			if i+4 >= len(value.units)-1 {
				return fail()
			}
			var unit uint16
			for j := 0; j < 4; j++ {
				i++
				c = value.units[i]
				var n uint16
				switch {
				case c >= '0' && c <= '9':
					n = c - '0'
				case c >= 'a' && c <= 'f':
					n = c - 'a' + 10
				case c >= 'A' && c <= 'F':
					n = c - 'A' + 10
				default:
					return fail()
				}
				unit = unit*16 + n
			}
			result = append(result, unit)
		default:
			return fail()
		}
	}
	return Text{result}, nil
}
