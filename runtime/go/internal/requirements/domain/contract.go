// Package domain owns strict Requirements policies independently of native adapters.
package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"ariadne/runtime/internal/core/domain/requirementfields"
)

type Criterion struct{ ID, Statement, Verification Text }
type Contract struct {
	ReqID, Status string
	Criteria      []Criterion
	Scope         []Text
}

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)

func Slug(reqID string) (string, error) {
	if !slugPattern.MatchString(reqID) {
		return "", errors.New("REQ slug must use lowercase letters, digits, and hyphens")
	}
	return reqID, nil
}
func fieldBlock(source Text, path ...string) (Text, error) {
	units, err := requirementfields.FieldBlock(source.units, path)
	return Text{units}, err
}
func ParseContract(yaml Text, reqID string) (Contract, error) {
	if _, err := Slug(reqID); err != nil {
		return Contract{}, err
	}
	start := true
	for _, u := range yaml.units {
		if u == 0 || start && u == 9 {
			return Contract{}, errors.New("REQ unsupported control character or indentation")
		}
		if lineTerm(u) {
			start = true
		} else if u != 32 {
			start = false
		}
	}
	top := map[string]bool{}
	for _, line := range yaml.splitLF() {
		if len(line.trim().units) == 0 || space(line.units[0]) || line.starts("#") {
			continue
		}
		key, tail, ok := mapping(line)
		if !ok || len(tail.units) > 0 && tail.units[0] != 32 {
			return Contract{}, errors.New("REQ requires canonical plain mapping keys")
		}
		if top[key] {
			return Contract{}, errors.New("REQ duplicate top-level mapping")
		}
		top[key] = true
	}
	metadata := func(key string) (Text, error) {
		block, err := fieldBlock(yaml, "metadata", key)
		if err != nil {
			return Text{}, err
		}
		lines := block.splitLF()
		prefix := "  " + key + ":"
		if !lines[0].starts(prefix) || len(lines[0].units) > len(prefix) && lines[0].units[len(prefix)] != 32 {
			return Text{}, fmt.Errorf("REQ metadata.%s is required", key)
		}
		return scalar(Text{lines[0].units[len(prefix):]}, lines[1:], 4)
	}
	id, err := metadata("req_id")
	if err != nil {
		return Contract{}, err
	}
	if !id.equal(reqID) {
		return Contract{}, errors.New("REQ metadata.req_id must match the filename slug")
	}
	status, err := metadata("status")
	if err != nil {
		return Contract{}, err
	}
	switch status.String() {
	case "needs_intake", "needs_clarification", "ready_for_routing", "verified":
	default:
		return Contract{}, errors.New("REQ metadata.status is unknown")
	}
	block, err := fieldBlock(yaml, "functional_contract", "acceptance_criteria")
	if err != nil {
		return Contract{}, err
	}
	criteria, err := criteriaFrom(block)
	if err != nil {
		return Contract{}, err
	}
	if len(criteria) == 0 {
		return Contract{}, errors.New("REQ acceptance_criteria must not be empty")
	}
	scope := make([]Text, 0, 10)
	for _, path := range []string{"requirement.user_intent", "requirement.desired_outcome", "requirement.confirmed_facts", "requirement.assumptions", "code_mapping.boundary_rules", "audit.must_not_implement", "verification.commands", "verification.verify_gate_required", "verification.verify_gate_reason", "verification.escalate_after"} {
		block, err := fieldBlock(yaml, strings.Split(path, ".")...)
		if err != nil {
			return Contract{}, err
		}
		scope = append(scope, block)
	}
	return Contract{reqID, status.String(), criteria, scope}, nil
}
func criteriaFrom(block Text) ([]Criterion, error) {
	lines := block.splitLF()
	header := lines[0]
	prefix := "  acceptance_criteria:"
	valid := header.starts(prefix)
	if valid {
		tail := Text{header.units[len(prefix):]}
		i := 0
		for i < len(tail.units) && tail.units[i] == 32 {
			i++
		}
		valid = len(tail.units) == 0 || i > 0 && (i == len(tail.units) || tail.units[i] == '#' && noLineTerms(Text{tail.units[i:]}))
	}
	if !valid {
		return nil, errors.New("REQ acceptance_criteria must be a canonical block list")
	}
	var items [][]Text
	for _, line := range lines[1:] {
		if line.starts("    - id:") && (len(line.units) == 9 || line.units[9] == 32) {
			items = append(items, []Text{{append([]uint16{' ', ' ', ' ', ' ', ' ', ' '}, line.units[6:]...)}})
		} else if len(items) > 0 {
			items[len(items)-1] = append(items[len(items)-1], line)
		} else if len(line.trim().units) > 0 && !comment(line) {
			return nil, errors.New("REQ unsupported acceptance_criteria item")
		}
	}
	ids := map[string]bool{}
	criteria := []Criterion{}
	for _, lines := range items {
		type field struct {
			head  Text
			lines []Text
		}
		fields := map[string]*field{}
		var current *field
		for _, line := range lines {
			key, head, ok := "", Text{}, false
			if line.starts("      ") {
				key, head, ok = mapping(Text{line.units[6:]})
				ok = ok && (len(head.units) == 0 || head.units[0] == 32 && noLineTerms(head))
			}
			if ok {
				switch key {
				case "id", "priority", "statement", "verification", "passes":
				default:
					return nil, errors.New("REQ unsupported AC field")
				}
				if fields[key] != nil {
					return nil, errors.New("REQ duplicate AC field")
				}
				current = &field{head: head}
				fields[key] = current
			} else if len(line.trim().units) == 0 || comment(line) && line.indent() < 8 {
				if current != nil && len(line.trim().units) == 0 {
					current.lines = append(current.lines, line)
				}
			} else {
				if current == nil || line.indent() < 8 {
					return nil, errors.New("REQ unsupported AC indentation or mapping")
				}
				current.lines = append(current.lines, line)
			}
		}
		values := []Text{}
		for _, key := range []string{"id", "statement", "verification"} {
			f := fields[key]
			if f == nil {
				return nil, fmt.Errorf("REQ AC %s is required", key)
			}
			value, err := scalar(f.head, f.lines, 8)
			if err != nil {
				return nil, err
			}
			if len(value.trim().units) == 0 {
				return nil, fmt.Errorf("REQ AC %s must not be empty", key)
			}
			values = append(values, value)
		}
		id := values[0].String()
		if !idPattern.MatchString(id) || ids[id] {
			return nil, errors.New("REQ invalid or duplicate AC ID")
		}
		ids[id] = true
		if f := fields["priority"]; f != nil {
			value, err := scalar(f.head, f.lines, 8)
			if err != nil {
				return nil, err
			}
			if !value.equal("P0") && !value.equal("P1") && !value.equal("P2") {
				return nil, errors.New("REQ unsupported AC priority")
			}
		}
		if f := fields["passes"]; f != nil {
			valid := true
			for _, line := range f.lines {
				if len(line.trim().units) > 0 && !comment(line) {
					valid = false
				}
			}
			value := f.head.trim()
			matched := false
			for _, token := range []string{"null", "true", "false"} {
				if value.starts(token) {
					tail := Text{value.units[len(token):]}
					i := tail.indent()
					matched = i == len(tail.units) || tail.units[i] == '#' && noLineTerms(Text{tail.units[i:]})
					if matched {
						break
					}
				}
			}
			if !valid || !matched {
				return nil, errors.New("REQ unsupported AC passes value")
			}
		}
		criteria = append(criteria, Criterion{values[0], values[1], values[2]})
	}
	return criteria, nil
}
