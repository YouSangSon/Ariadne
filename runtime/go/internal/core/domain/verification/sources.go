package verification

import (
	"errors"
	"fmt"
	"slices"
)

func SourceTests(names []Text, withCode bool) ([]Text, error) {
	const suffix = ".test.mjs"
	tests := make([]Text, 0, len(names))
	hasCodeTest := false
	for _, name := range names {
		suffixStart := len(name.units) - len(suffix)
		if suffixStart < 0 || !hasASCIIPrefix(name.units[suffixStart:], suffix) || equalASCII(name.units, "product-mcp.test.mjs") {
			continue
		}
		if equalASCII(name.units, "product-code.test.mjs") {
			if !withCode {
				continue
			}
			hasCodeTest = true
		}
		tests = append(tests, name)
	}
	if len(tests) == 0 {
		return nil, errors.New("core tests가 없다")
	}
	if withCode && !hasCodeTest {
		return nil, errors.New("code integration test is missing")
	}
	slices.SortFunc(tests, func(a, b Text) int { return slices.Compare(a.units, b.units) })
	return tests, nil
}

func equalASCII(units []uint16, literal string) bool {
	return len(units) == len(literal) && hasASCIIPrefix(units, literal)
}

func CommitErrors(log Text) *Text {
	count := 0
	var prefixes []uint16
	for remaining := log.units; len(remaining) > 0; {
		message := remaining
		remaining = nil
		if end := slices.Index(message, 0); end >= 0 {
			message, remaining = message[:end], message[end+1:]
		}
		message = trimWhitespace(message)
		if len(message) == 0 || HasRequirementReference(Text{units: message}) {
			continue
		}
		if count > 0 {
			prefixes = append(prefixes, ',', ' ')
		}
		count++
		prefixes = append(prefixes, message[:min(len(message), 7)]...)
	}
	if count == 0 {
		return nil
	}
	failure := TextOf(fmt.Sprintf("REQ 참조 없는 커밋 %d개: ", count))
	failure.units = append(failure.units, prefixes...)
	return &failure
}

func trimWhitespace(units []uint16) []uint16 {
	for len(units) > 0 && jsWhitespace(units[0]) {
		units = units[1:]
	}
	end := len(units)
	for end > 0 && jsWhitespace(units[end-1]) {
		end--
	}
	return units[:end]
}
