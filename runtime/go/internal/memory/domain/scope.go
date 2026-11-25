package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"strings"
)

type ScopeKind uint8

const (
	ReadScope ScopeKind = iota + 1
	WriteScope
	AdminScope
)

func (k ScopeKind) String() string {
	return [...]string{ReadScope: "read", WriteScope: "write", AdminScope: "admin"}[k]
}

// toolScopes is the OAuth scope each tool needs; compact_memory needs admin only when it applies changes.
var toolScopes = map[string]ScopeKind{
	"add_memory": WriteScope, "add_memory_interactive": WriteScope, "start_goal_run": WriteScope,
	"record_iteration": WriteScope, "complete_goal_run": WriteScope, "abandon_goal_run": WriteScope,
	"compact_memory": ReadScope,
	"reindex_memory": AdminScope, "unarchive_memory": AdminScope, "list_audit_log": AdminScope,
	"update_memory": AdminScope, "delete_memory": AdminScope, "tag_memory": AdminScope,
	"search_memory": ReadScope, "list_memory": ReadScope, "inspect_memory_graph": ReadScope,
	"inspect_memory_impact": ReadScope, "build_context_pack": ReadScope, "list_workspace_roots": ReadScope,
	"classify_memory_candidate": ReadScope, "get_goal_run": ReadScope, "list_goal_runs": ReadScope,
	"build_goal_context": ReadScope, "check_repeat_attempt": ReadScope,
}

var acceptedScopes = map[ScopeKind][]string{
	ReadScope:  {"akasha:memory", "akasha:read", "akasha:admin"},
	WriteScope: {"akasha:memory", "akasha:write", "akasha:admin"},
	AdminScope: {"akasha:memory", "akasha:admin"},
}

var preferredScope = map[ScopeKind]string{ReadScope: "akasha:read", WriteScope: "akasha:write", AdminScope: "akasha:admin"}

func RequiredScopeKind(tool string, input map[string]json.RawMessage) (ScopeKind, error) {
	kind, known := toolScopes[tool]
	if !known {
		return 0, errors.New("unsupported OAuth scope tool: " + tool)
	}
	if tool == "compact_memory" && string(bytes.TrimSpace(input["dryRun"])) == "false" {
		return AdminScope, nil
	}
	return kind, nil
}

// ScopeChallenge names the scope a client must request after an insufficient_scope rejection.
type ScopeChallenge struct {
	Kind  ScopeKind
	Scope string
}

type InsufficientScopeError struct{ Challenge ScopeChallenge }

func (e *InsufficientScopeError) Error() string { return "insufficient_scope" }

// ProtectedResource is the OAuth protected-resource metadata the challenge headers read.
type ProtectedResource struct {
	MetadataURL     string
	ScopesSupported []string
}

func (r ProtectedResource) Challenge() string {
	return `Bearer resource_metadata="` + quoteAuthParam(r.MetadataURL) + `", scope="` + quoteAuthParam(strings.Join(r.ScopesSupported, " ")) + `"`
}

func (r ProtectedResource) InsufficientScope(scope string) string {
	return `Bearer error="insufficient_scope", resource_metadata="` + quoteAuthParam(r.MetadataURL) + `", scope="` + quoteAuthParam(scope) + `"`
}

// CheckScopes returns nil when the call may proceed. Only OAuth principals carry scopes.
func CheckScopes(principal *Principal, tool string, input map[string]json.RawMessage, resource *ProtectedResource) (*ScopeChallenge, error) {
	if principal == nil || principal.Type != OAuthAuth {
		return nil, nil
	}
	kind, err := RequiredScopeKind(tool, input)
	if err != nil {
		return nil, err
	}
	for _, scope := range acceptedScopes[kind] {
		if slices.Contains(principal.Scopes, scope) {
			return nil, nil
		}
	}
	var supported []string
	if resource != nil {
		supported = resource.ScopesSupported
	}
	challenge := preferredScope[kind]
	if !slices.Contains(supported, challenge) && slices.Contains(supported, "akasha:memory") {
		challenge = "akasha:memory"
	}
	return &ScopeChallenge{Kind: kind, Scope: challenge}, nil
}

// gateFields are the input members authorization reads. Node's object schemas strip unknown members, but
// encoding/json binds struct fields case-insensitively, so "organizationid" would reach a Go tool as the
// organizationId the gate never checked.
var gateFields = []string{"organizationId", "dryRun"}

// WithoutShadowingFields returns input without the members that differ from a gate field only in letter case.
func WithoutShadowingFields(input map[string]json.RawMessage) map[string]json.RawMessage {
	kept := maps.Clone(input)
	maps.DeleteFunc(kept, func(key string, _ json.RawMessage) bool {
		return slices.ContainsFunc(gateFields, func(field string) bool { return key != field && strings.EqualFold(key, field) })
	})
	return kept
}

// ToolInputError is Node's schema issue for a gate field, as "path: reason".
type ToolInputError struct{ Issue string }

func (e *ToolInputError) Error() string { return e.Issue }

// gateFieldRules are Node's tool-schema types for the gate fields a tool constrains.
var gateFieldRules = map[string]struct {
	field, want string
	required    bool
}{
	"compact_memory": {"dryRun", "boolean", false},
	"reindex_memory": {"organizationId", "string", true},
}

// CheckGateFields applies Node's tool-schema rules for the fields authorization depends on. Without them a Go
// tool could read null or "false" as an apply that only needed read scope, or reindex outside any organization.
func CheckGateFields(tool string, input map[string]json.RawMessage) error {
	rule, constrained := gateFieldRules[tool]
	raw, present := input[rule.field]
	if !constrained || !present && !rule.required {
		return nil
	}
	received := jsonType(raw, present)
	if received != rule.want {
		return &ToolInputError{Issue: rule.field + ": Invalid input: expected " + rule.want + ", received " + received}
	}
	if received != "string" {
		return nil
	}
	// Node's organizationId schema is a non-blank string, and OrganizationID("") means no organization in Go.
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return err
	}
	switch {
	case text == "":
		return &ToolInputError{Issue: rule.field + ": Too small: expected string to have >=1 characters"}
	case jsTrim(text) == "":
		return &ToolInputError{Issue: rule.field + ": must contain non-whitespace text"}
	}
	return nil
}

// jsonType names a member's JSON type as zod reports it.
func jsonType(raw json.RawMessage, present bool) string {
	trimmed := bytes.TrimSpace(raw)
	if !present || len(trimmed) == 0 {
		return "undefined"
	}
	switch trimmed[0] {
	case 'n':
		return "null"
	case 't', 'f':
		return "boolean"
	case '"':
		return "string"
	case '[':
		return "array"
	case '{':
		return "object"
	}
	return "number"
}

// AuthorizeToolCall applies the MCP scope and organization checks and returns the input the tool receives.
// The Node MCP SDK validates the tool schema first, so the gate fields are checked before the scopes. Tool
// schemas admit only string organizationId values, so other values are left to schema validation.
func AuthorizeToolCall(principal Principal, tool string, input map[string]json.RawMessage, resource *ProtectedResource) (map[string]json.RawMessage, error) {
	input = WithoutShadowingFields(input)
	if err := CheckGateFields(tool, input); err != nil {
		return nil, err
	}
	challenge, err := CheckScopes(&principal, tool, input, resource)
	if err != nil {
		return nil, err
	}
	if challenge != nil {
		return nil, &InsufficientScopeError{Challenge: *challenge}
	}
	if principal.Organization == "" {
		return input, nil
	}
	var requested any
	if raw, present := input["organizationId"]; present {
		if err := json.Unmarshal(raw, &requested); err != nil {
			return nil, err
		}
	}
	if text, isString := requested.(string); isString && OrganizationID(jsTrim(text)) != principal.Organization {
		return nil, ErrOrganizationMismatch
	}
	return WithOrganization(input, principal.Organization), nil
}

func quoteAuthParam(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`)
}
