package domain

import (
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"testing"
)

// The MCP SDK applies the Node tool schema before the authorizer runs: unknown members are stripped and a
// non-boolean dryRun is rejected, so neither reaches the scope check or the tool.
func TestAuthorizeToolCallAppliesSchemaGateFirst(t *testing.T) {
	reader := Principal{Type: OAuthAuth, Organization: "org-a", Scopes: []string{"akasha:read"}}
	cases := []struct {
		name      string
		principal Principal
		tool      string
		input     string
		wantKeys  []string
		wantIssue string
		wantScope bool
	}{
		{name: "case variants of organizationId are dropped", principal: reader, tool: "search_memory",
			input: `{"query":"q","organizationid":"org-b","ORGANIZATIONID":"org-b"}`, wantKeys: []string{"organizationId", "query"}},
		{name: "case variants of dryRun are dropped", principal: reader, tool: "compact_memory",
			input: `{"dryrun":false,"DryRun":false}`, wantKeys: []string{"organizationId"}},
		{name: "null dryRun is a schema error before the scope check", principal: Principal{Type: OAuthAuth}, tool: "compact_memory",
			input: `{"dryRun":null}`, wantIssue: "dryRun: Invalid input: expected boolean, received null"},
		{name: "string dryRun is a schema error", principal: reader, tool: "compact_memory",
			input: `{"dryRun":"false"}`, wantIssue: "dryRun: Invalid input: expected boolean, received string"},
		{name: "number dryRun is a schema error", principal: reader, tool: "compact_memory",
			input: `{"dryRun":0}`, wantIssue: "dryRun: Invalid input: expected boolean, received number"},
		{name: "boolean false still needs admin scope", principal: reader, tool: "compact_memory",
			input: `{"dryRun":false}`, wantScope: true},
		{name: "dryRun on another tool is left to its schema", principal: reader, tool: "list_memory",
			input: `{"dryRun":"x"}`, wantKeys: []string{"dryRun", "organizationId"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var input map[string]json.RawMessage
			if err := json.Unmarshal([]byte(tc.input), &input); err != nil {
				t.Fatal(err)
			}
			authorized, err := AuthorizeToolCall(tc.principal, tc.tool, input, nil)
			var invalid *ToolInputError
			var denied *InsufficientScopeError
			switch {
			case tc.wantIssue != "":
				if !errors.As(err, &invalid) || invalid.Issue != tc.wantIssue {
					t.Fatalf("err = %v, want tool input issue %q", err, tc.wantIssue)
				}
			case tc.wantScope:
				if !errors.As(err, &denied) {
					t.Fatalf("err = %v, want insufficient scope", err)
				}
			case err != nil:
				t.Fatal(err)
			default:
				if keys := slices.Sorted(maps.Keys(authorized)); !slices.Equal(keys, tc.wantKeys) {
					t.Fatalf("tool input keys = %v, want %v", keys, tc.wantKeys)
				}
			}
		})
	}
}
