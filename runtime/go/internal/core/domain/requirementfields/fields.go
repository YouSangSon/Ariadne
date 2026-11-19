// Package requirementfields owns the existing partial REQ field extraction policy.
package requirementfields

import (
	"fmt"
	"strings"
)

func space(c uint16) bool {
	switch c {
	case 9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return c >= 0x2000 && c <= 0x200a
}
func indent(line []uint16) int {
	for i, c := range line {
		if !space(c) {
			return i
		}
	}
	return len(line)
}
func trimEnd(line []uint16) []uint16 {
	end := len(line)
	for end > 0 && space(line[end-1]) {
		end--
	}
	return line[:end]
}
func prefix(line []uint16, s string) bool {
	if len(line) < len(s) {
		return false
	}
	for i := range s {
		if line[i] != uint16(s[i]) {
			return false
		}
	}
	return true
}
func split(source []uint16) [][]uint16 {
	var lines [][]uint16
	start := 0
	for i, c := range source {
		if c == 10 {
			lines = append(lines, source[start:i])
			start = i + 1
		}
	}
	return append(lines, source[start:])
}
func join(lines [][]uint16) []uint16 {
	var result []uint16
	for i, line := range lines {
		if i > 0 {
			result = append(result, 10)
		}
		result = append(result, line...)
	}
	return result
}
func comment(line []uint16) bool { i := indent(line); return i < len(line) && line[i] == '#' }
func letter(c uint16) bool       { return c >= 'a' && c <= 'z' || c == '_' }
func digit(c uint16) bool        { return c >= '0' && c <= '9' }
func plainKey(line []uint16) bool {
	i := indent(line)
	if i == len(line) || !letter(line[i]) {
		return false
	}
	i++
	for i < len(line) && (letter(line[i]) || digit(line[i])) {
		i++
	}
	return i < len(line) && line[i] == ':'
}
func malformed(line []uint16, key string) bool {
	i := indent(line)
	if i < len(line) && line[i] == '?' {
		i++
		i += indent(line[i:])
	}
	if i < len(line) && (line[i] == '\'' || line[i] == '"') {
		i++
	}
	if !prefix(line[i:], key) {
		return false
	}
	i += len(key)
	if i < len(line) && (line[i] == '\'' || line[i] == '"') {
		i++
	}
	i += indent(line[i:])
	return i == len(line) || line[i] == ':'
}
func alias(source []uint16) bool {
	for i, c := range source {
		if c != '*' && c != '&' {
			continue
		}
		if i > 0 && !space(source[i-1]) && source[i-1] != '[' && source[i-1] != ',' {
			continue
		}
		if i+1 < len(source) {
			n := source[i+1]
			if letter(n) || digit(n) || n >= 'A' && n <= 'Z' || n == '-' {
				return true
			}
		}
	}
	return false
}
func blockHeader(line []uint16, p string) bool {
	rest := line[len(p):]
	i := indent(rest)
	if i == len(rest) {
		return true
	}
	if rest[i] != '#' {
		return false
	}
	for j := i + 1; j < len(rest); j++ {
		switch rest[j] {
		case 10, 13, 0x2028, 0x2029:
			return false
		}
	}
	return true
}

// FieldBlock intentionally validates only the selected two-space mapping path.
// shortcut: this is the Node partial template parser; use a YAML parser if semantic YAML is required.
func FieldBlock(source []uint16, path []string) ([]uint16, error) {
	lines := split(source)
	for depth, key := range path {
		p := strings.Repeat("  ", depth)
		start := -1
		for i, line := range lines {
			if prefix(line, p+key+":") {
				if start >= 0 {
					return nil, fmt.Errorf("REQ %s: 중복 필드", strings.Join(path, "."))
				}
				start = i
			}
		}
		if start < 0 {
			for _, line := range lines {
				if malformed(line, key) {
					return nil, fmt.Errorf("REQ %s: 템플릿의 2칸 들여쓰기 mapping이 필요하다", key)
				}
			}
			return nil, nil
		}
		end := start + 1
		for end < len(lines) && (len(trimEnd(lines[end])) == 0 || comment(lines[end]) || indent(lines[end]) > len(p)) {
			end++
		}
		lines = lines[start:end]
		if alias(join(lines)) {
			return nil, fmt.Errorf("REQ %s: YAML alias/anchor는 지원하지 않는다", strings.Join(path, "."))
		}
		mapping := depth < len(path)-1
		switch key {
		case "metadata", "requirement", "functional_contract", "code_mapping", "audit", "clarification", "verification":
			mapping = true
		}
		if mapping && !blockHeader(lines[0], p+key+":") {
			return nil, fmt.Errorf("REQ %s: 템플릿의 block mapping이 필요하다", key)
		}
		if depth < len(path)-1 || key == "verification" {
			first := true
			for _, line := range lines[1:] {
				if len(trimEnd(line)) == 0 || comment(line) {
					continue
				}
				n := indent(line)
				if first && n != len(p)+2 || n == len(p)+2 && !plainKey(line) {
					return nil, fmt.Errorf("REQ %s: 템플릿의 plain mapping key와 2칸 들여쓰기가 필요하다", key)
				}
				first = false
			}
		}
	}
	return trimEnd(join(lines)), nil
}
