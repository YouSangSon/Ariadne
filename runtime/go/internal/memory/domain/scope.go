package domain

import (
	"encoding/json"
	"errors"
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
	if tool == "compact_memory" && string(input["dryRun"]) == "false" {
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

// AuthorizeToolCall applies the MCP scope and organization checks and returns the input the tool receives.
// Tool schemas admit only string organizationId values, so other values are left to schema validation.
func AuthorizeToolCall(principal Principal, tool string, input map[string]json.RawMessage, resource *ProtectedResource) (map[string]json.RawMessage, error) {
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
