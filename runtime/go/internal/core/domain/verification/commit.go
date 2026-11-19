package verification

import (
	"fmt"
	"slices"
)

type Decision struct {
	OK, Skip bool
	Reason   *Text
}

func CheckCommitCommand(command Text) Decision {
	const subjectMax = 70
	gitEnd := wordEnd(command.units, "git", 0, true)
	if gitEnd < 0 || wordEnd(command.units, "commit", gitEnd, true) < 0 {
		return Decision{OK: true, Skip: true}
	}
	if wordEnd(command.units, "--no-verify", 0, false) >= 0 {
		return reject(TextOf("--no-verify 금지 — 우회는 CI에서 잡힌다. 훅/검사를 고치든가 사유를 REQ에 남겨라"))
	}
	quoted := quotedCommitMessage(command.units)
	if quoted == nil {
		return Decision{OK: true, Skip: true}
	}
	// The hook performs two literal substitutions on the first complete match.
	message := replaceEscapedUnit(slices.Clone(quoted), 'n', '\n')
	message = replaceEscapedUnit(message, '"', '"')
	subject := message
	if end := slices.Index(message, '\n'); end >= 0 {
		subject = message[:end]
	}
	if !conventionalSubject(subject) {
		reason := TextOf("제목이 conventional 형식이 아님: \"")
		reason.units = append(reason.units, subject...)
		reason.units = append(reason.units, '"')
		return reject(reason)
	}
	if len(subject) > subjectMax {
		return reject(TextOf(fmt.Sprintf("제목 %d자 — %d자 초과", len(subject), subjectMax)))
	}
	if !HasRequirementReference(Text{units: message}) {
		return reject(TextOf("커밋 불변식: \"REQ: <slug>\" 또는 \"REQ: none (<사유>)\" 줄이 필요"))
	}
	return Decision{OK: true}
}

func reject(reason Text) Decision { return Decision{Reason: &reason} }

func wordEnd(units []uint16, word string, start int, requireStart bool) int {
	for i := start; i+len(word) <= len(units); i++ {
		end := i + len(word)
		if (end == len(units) || !asciiWord(units[end])) &&
			(!requireStart || i == 0 || !asciiWord(units[i-1])) &&
			hasASCIIPrefix(units[i:], word) {
			return end
		}
	}
	return -1
}

func asciiWord(unit uint16) bool {
	return asciiLowerOrDigit(unit) || unit >= 'A' && unit <= 'Z' || unit == '_'
}

func asciiLowerOrDigit(unit uint16) bool {
	return unit >= 'a' && unit <= 'z' || unit >= '0' && unit <= '9'
}

func quotedCommitMessage(units []uint16) []uint16 {
	for start := 0; start+2 < len(units); start++ {
		if units[start] != '-' || units[start+1] != 'm' || !jsWhitespace(units[start+2]) {
			continue
		}
		quote := start + 3
		for quote < len(units) && jsWhitespace(units[quote]) {
			quote++
		}
		if quote == len(units) {
			return nil
		}
		content := units[quote+1:]
		switch units[quote] {
		case '\'':
			if end := slices.Index(content, '\''); end >= 0 {
				return content[:end]
			}
		case '"':
			if end := doubleQuoteEnd(content); end >= 0 {
				return content[:end]
			}
		}
	}
	return nil
}

func doubleQuoteEnd(units []uint16) int {
	for i := 0; i < len(units); i++ {
		switch units[i] {
		case '"':
			return i
		case '\\':
			i++
			if i == len(units) || jsLineTerminator(units[i]) {
				return -1
			}
		}
	}
	return -1
}

func replaceEscapedUnit(units []uint16, escaped, replacement uint16) []uint16 {
	out := units[:0]
	for i := 0; i < len(units); i++ {
		unit := units[i]
		if unit == '\\' && i+1 < len(units) && units[i+1] == escaped {
			unit = replacement
			i++
		}
		out = append(out, unit)
	}
	return out
}

func conventionalSubject(units []uint16) bool {
	// Subject extraction splits on LF, while the regex's dot stops at other JS line terminators too.
	if end := slices.IndexFunc(units, jsLineTerminator); end >= 0 {
		units = units[:end]
	}
	for _, kind := range [...]string{"feat", "fix", "refactor", "docs", "test", "chore", "perf", "ci", "style", "build"} {
		if !hasASCIIPrefix(units, kind) {
			continue
		}
		tail := units[len(kind):]
		if len(tail) > 2 && hasASCIIPrefix(tail, ": ") {
			return true
		}
		if len(tail) == 0 || tail[0] != '(' {
			return false
		}
		for end := 2; end+3 < len(tail); end++ {
			if hasASCIIPrefix(tail[end:], "): ") {
				return true
			}
		}
		return false
	}
	return false
}

func HasRequirementReference(text Text) bool {
	start := 0
	for end, unit := range text.units {
		if jsLineTerminator(unit) {
			if requirementLine(text.units[start:end]) {
				return true
			}
			start = end + 1
		}
	}
	return requirementLine(text.units[start:])
}

func requirementLine(line []uint16) bool {
	const prefix = "REQ: "
	if len(line) <= len(prefix) || !hasASCIIPrefix(line, prefix) {
		return false
	}
	value := line[len(prefix):]
	if len(value) > len("none ()") && hasASCIIPrefix(value, "none (") && value[len(value)-1] == ')' {
		return true
	}
	if !asciiLowerOrDigit(value[0]) {
		return false
	}
	for _, unit := range value[1:] {
		if !asciiLowerOrDigit(unit) && unit != '-' {
			return false
		}
	}
	return true
}
