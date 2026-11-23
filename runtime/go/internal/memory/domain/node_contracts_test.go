package domain

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

type fixtureAuth struct {
	AuthType       string    `json:"authType"`
	OrganizationID string    `json:"organizationId"`
	Scopes         *[]string `json:"scopes"`
}

type authCase struct {
	ID                   string                     `json:"id"`
	Op                   string                     `json:"op"`
	Raw                  *string                    `json:"raw"`
	Headers              [][2]string                `json:"headers"`
	Body                 map[string]json.RawMessage `json:"body"`
	AuthOrganization     *string                    `json:"auth_organization"`
	Tool                 string                     `json:"tool"`
	Input                map[string]json.RawMessage `json:"input"`
	Auth                 *fixtureAuth               `json:"auth"`
	ScopesSupported      *[]string                  `json:"scopes_supported"`
	MetadataURL          string                     `json:"metadata_url"`
	TokenCount           int                        `json:"token_count"`
	Host                 string                     `json:"host"`
	OAuth                json.RawMessage            `json:"oauth"`
	OrganizationID       *string                    `json:"organization_id"`
	AllowLegacyAnonymous *bool                      `json:"allow_legacy_anonymous"`
	Fn                   string                     `json:"fn"`
}

func loadContract(t *testing.T, name string, target any) {
	t.Helper()
	data, err := os.ReadFile("../../../../../contracts/memory/auth-node-v1/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatal(err)
	}
}

func asJSON(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func optional[T comparable](value T) any {
	var zero T
	if value == zero {
		return nil
	}
	return value
}

func fixturePrincipal(auth *fixtureAuth) *Principal {
	if auth == nil {
		return nil
	}
	principal := &Principal{Token: "fixture-token", Organization: OrganizationID(auth.OrganizationID), Type: StaticAuth}
	if auth.AuthType == "oauth" {
		principal.Type = OAuthAuth
	}
	if auth.Scopes != nil {
		principal.Scopes = *auth.Scopes
	}
	return principal
}

func scopeFailure(err error, resource *ProtectedResource) map[string]any {
	var denied *InsufficientScopeError
	header := any(nil)
	if errors.As(err, &denied) && resource != nil {
		header = resource.InsufficientScope(denied.Challenge.Scope)
	}
	return map[string]any{"error": err.Error(), "www_authenticate": header}
}

func observeDomain(t *testing.T, entry authCase, metadataURL string) map[string]any {
	t.Helper()
	var resource *ProtectedResource
	if entry.ScopesSupported != nil {
		resource = &ProtectedResource{MetadataURL: metadataURL, ScopesSupported: *entry.ScopesSupported}
	}
	switch entry.Op {
	case "static_tokens":
		raw := ""
		if entry.Raw != nil {
			raw = *entry.Raw
		}
		tokens, err := ParseStaticTokens(raw)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		parsed := []any{}
		for _, token := range tokens {
			parsed = append(parsed, map[string]any{"token": token.secret, "organizationId": optional(token.organization)})
		}
		return map[string]any{"tokens": parsed}
	case "resolve_organization":
		var values []string
		for _, header := range entry.Headers {
			if strings.EqualFold(header[0], "x-organization-id") {
				values = append(values, header[1])
			}
		}
		bound := OrganizationID("")
		if entry.AuthOrganization != nil {
			bound = OrganizationID(*entry.AuthOrganization)
		}
		organization, err := ResolveOrganization(values, entry.Body["organizationId"], bound)
		var invalid *OrganizationError
		switch {
		case errors.As(err, &invalid):
			return map[string]any{"organizationId": nil, "conflict": false, "validationError": invalid.Message}
		case errors.Is(err, ErrOrganizationMismatch):
			return map[string]any{"organizationId": string(bound), "conflict": true, "validationError": nil}
		case err != nil:
			t.Fatalf("%s: unexpected error %v", entry.ID, err)
		}
		return map[string]any{"organizationId": optional(organization), "conflict": false, "validationError": nil}
	case "scope_kind":
		kind, err := RequiredScopeKind(entry.Tool, entry.Input)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		return map[string]any{"kind": kind.String()}
	case "check_scopes":
		challenge, err := CheckScopes(fixturePrincipal(entry.Auth), entry.Tool, entry.Input, resource)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		if challenge == nil {
			return map[string]any{"ok": true}
		}
		header := any(nil)
		if resource != nil {
			header = resource.InsufficientScope(challenge.Scope)
		}
		return map[string]any{"ok": false, "kind": challenge.Kind.String(), "challengeScope": challenge.Scope, "insufficient_scope_header": header}
	case "mcp_context", "mcp_service":
		input, err := AuthorizeToolCall(*fixturePrincipal(entry.Auth), entry.Tool, entry.Input, resource)
		if err != nil {
			return scopeFailure(err, resource)
		}
		if entry.Op == "mcp_context" {
			return map[string]any{"ok": true}
		}
		return map[string]any{"input": input}
	case "www_authenticate":
		return map[string]any{"header": ProtectedResource{MetadataURL: entry.MetadataURL, ScopesSupported: *entry.ScopesSupported}.Challenge()}
	case "safe_auth_config":
		result := map[string]any{"loopback": IsLoopbackHost(entry.Host), "ok": true}
		if err := CheckBindAuthentication(entry.TokenCount, entry.Host, string(entry.OAuth) == "true"); err != nil {
			result = map[string]any{"loopback": IsLoopbackHost(entry.Host), "error": err.Error()}
		}
		return result
	case "assert_organization":
		allow := entry.AllowLegacyAnonymous != nil && *entry.AllowLegacyAnonymous
		if err := RequireOrganization(entry.OrganizationID, allow, entry.Fn); err != nil {
			return map[string]any{"error": err.Error()}
		}
		return map[string]any{"ok": true}
	}
	return nil
}

func TestNodeAuthContracts(t *testing.T) {
	var corpus struct {
		Cases []authCase `json:"cases"`
	}
	var expected struct {
		MetadataURL string           `json:"challenge_metadata_url"`
		Cases       []map[string]any `json:"cases"`
	}
	loadContract(t, "cases.json", &corpus)
	loadContract(t, "expected.json", &expected)
	if len(corpus.Cases) != len(expected.Cases) {
		t.Fatalf("cases %d, expected %d", len(corpus.Cases), len(expected.Cases))
	}
	checked := 0
	for index, entry := range corpus.Cases {
		want := expected.Cases[index]
		if want["id"] != entry.ID {
			t.Fatalf("case %d: id %v, expected %s", index, want["id"], entry.ID)
		}
		if entry.Op == "authenticate" {
			continue // the application Authenticator owns these cases
		}
		got := observeDomain(t, entry, expected.MetadataURL)
		if got == nil {
			t.Fatalf("%s: unsupported operation %s", entry.ID, entry.Op)
		}
		got["id"] = entry.ID
		if decoded := asJSON(t, got); !reflect.DeepEqual(decoded, want) {
			t.Errorf("%s:\n got  %v\n want %v", entry.ID, decoded, want)
		}
		checked++
	}
	if checked < 100 {
		t.Fatalf("only %d domain cases checked", checked)
	}
}
