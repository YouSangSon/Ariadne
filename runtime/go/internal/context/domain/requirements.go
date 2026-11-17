package domain

import (
	"ariadne/runtime/internal/core/domain/requirementfields"
	"errors"
	"fmt"
)

func asciiLetter(c uint16) bool { return c >= 'a' && c <= 'z' || c == '_' }
func asciiDigit(c uint16) bool  { return c >= '0' && c <= '9' }
func plainMapping(line Text) bool {
	if line.Len() == 0 || !asciiLetter(line.units[0]) {
		return false
	}
	i := 1
	for i < line.Len() && (asciiLetter(line.units[i]) || asciiDigit(line.units[i])) {
		i++
	}
	return i < line.Len() && line.units[i] == ':'
}

// ValidRequirementSlug keeps the Context REQ grammar, distinct from skill slugs.
func ValidRequirementSlug(slug string) bool {
	if slug == "" {
		return false
	}
	for i, c := range []byte(slug) {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || i > 0 && c == '-') {
			return false
		}
	}
	return true
}
func scalarTail(t Text) bool {
	t = t.trimStart()
	if t.Len() == 0 {
		return true
	}
	if t.units[0] != '#' {
		return false
	}
	for _, c := range t.units {
		if lineTerm(c) {
			return false
		}
	}
	return true
}
func reqScalar(block []uint16, prefix string, status bool) (Text, bool) {
	t := Text{block}
	if !t.starts(prefix) {
		return Text{}, false
	}
	u := t.units[len(prefix):]
	quote := uint16(0)
	if len(u) > 0 && (u[0] == '\'' || u[0] == '"') {
		quote = u[0]
		u = u[1:]
	}
	i := 0
	for i < len(u) && (u[i] >= 'a' && u[i] <= 'z' || asciiDigit(u[i]) || i > 0 && u[i] == '-' || status && u[i] == '_') {
		i++
	}
	if i == 0 {
		return Text{}, false
	}
	value := Text{u[:i]}
	u = u[i:]
	if quote != 0 {
		if len(u) == 0 || u[0] != quote {
			return Text{}, false
		}
		u = u[1:]
	}
	return value, scalarTail(Text{u})
}

// RequirementStatus validates the same partial Context metadata, not Execution's strict REQ.
func RequirementStatus(text Text, slug string) (string, error) {
	first := true
	for _, line := range text.splitLF() {
		if line.trim().Len() == 0 || line.trimStart().starts("#") {
			continue
		}
		if first && !plainMapping(line) || !esSpace(line.units[0]) && !plainMapping(line) {
			return "", errors.New("REQ: 템플릿의 plain mapping key가 필요하다")
		}
		first = false
	}
	block, err := requirementfields.FieldBlock(text.units, []string{"metadata", "req_id"})
	if err != nil {
		return "", err
	}
	id, ok := reqScalar(block, "  req_id: ", false)
	if !ok || !id.equal(FromString(slug)) {
		return "", fmt.Errorf("REQ %s: metadata.req_id는 파일명 slug와 같아야 한다", slug)
	}
	block, err = requirementfields.FieldBlock(text.units, []string{"metadata", "status"})
	if err != nil {
		return "", err
	}
	value, ok := reqScalar(block, "  status: ", true)
	for _, status := range []string{"needs_intake", "needs_clarification", "ready_for_routing", "verified"} {
		if ok && value.equal(FromString(status)) {
			return status, nil
		}
	}
	return "", fmt.Errorf("REQ %s: metadata.status에 알려진 네 가지 상태 중 하나가 필요하다", slug)
}
