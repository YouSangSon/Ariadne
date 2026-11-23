package application

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"ariadne/runtime/internal/memory/domain"
)

type fixtureIdentity struct {
	OrganizationID *string  `json:"organizationId"`
	Scopes         []string `json:"scopes"`
}

type authenticateCase struct {
	ID            string  `json:"id"`
	Op            string  `json:"op"`
	Tokens        string  `json:"tokens"`
	Authorization *string `json:"authorization"`
	OAuth         *struct {
		Result *fixtureIdentity `json:"result"`
	} `json:"oauth"`
}

type recordingVerifier struct {
	result *fixtureIdentity
	calls  []string
}

func (v *recordingVerifier) Verify(_ context.Context, token string) (OAuthIdentity, bool) {
	v.calls = append(v.calls, token)
	if v.result == nil {
		return OAuthIdentity{}, false
	}
	identity := OAuthIdentity{Scopes: v.result.Scopes}
	if v.result.OrganizationID != nil {
		organization, ok := domain.ParseOrganizationID(*v.result.OrganizationID)
		if !ok {
			panic("fixture verifier returned a blank organization")
		}
		identity.Organization = organization
	}
	return identity, true
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

func principalJSON(principal domain.Principal, ok bool) any {
	if !ok {
		return nil
	}
	organization := any(nil)
	if principal.Organization != "" {
		organization = string(principal.Organization)
	}
	authType := map[domain.AuthType]string{domain.StaticAuth: "static", domain.OAuthAuth: "oauth"}[principal.Type]
	scopes := any(nil)
	if principal.Scopes != nil {
		scopes = principal.Scopes
	}
	return map[string]any{"token": principal.Token, "organizationId": organization, "authType": authType, "scopes": scopes}
}

func TestNodeAuthenticateContracts(t *testing.T) {
	var corpus struct {
		Cases []json.RawMessage `json:"cases"`
	}
	var expected struct {
		Cases []map[string]any `json:"cases"`
	}
	loadContract(t, "cases.json", &corpus)
	loadContract(t, "expected.json", &expected)
	checked := 0
	for index, raw := range corpus.Cases {
		var operation struct{ Op string }
		if err := json.Unmarshal(raw, &operation); err != nil {
			t.Fatal(err)
		}
		if operation.Op != "authenticate" {
			continue
		}
		var entry authenticateCase
		if err := json.Unmarshal(raw, &entry); err != nil {
			t.Fatal(err)
		}
		tokens, err := domain.ParseStaticTokens(entry.Tokens)
		if err != nil {
			t.Fatalf("%s: %v", entry.ID, err)
		}
		var verifier *recordingVerifier
		authenticator := NewAuthenticator(tokens, nil)
		if entry.OAuth != nil {
			verifier = &recordingVerifier{result: entry.OAuth.Result}
			authenticator = NewAuthenticator(tokens, verifier)
		}
		authorization := ""
		if entry.Authorization != nil {
			authorization = *entry.Authorization
		}
		calls := []string{}
		principal, ok := authenticator.Authenticate(context.Background(), authorization)
		if verifier != nil {
			calls = append(calls, verifier.calls...)
		}
		got := map[string]any{"id": entry.ID, "principal": principalJSON(principal, ok), "verifier_calls": calls}
		data, _ := json.Marshal(got)
		var decoded any
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatal(err)
		}
		if want := expected.Cases[index]; !reflect.DeepEqual(decoded, want) {
			t.Errorf("%s:\n got  %v\n want %v", entry.ID, decoded, want)
		}
		checked++
	}
	if checked < 15 {
		t.Fatalf("only %d authenticate cases checked", checked)
	}
}

func TestAuthenticatorRequired(t *testing.T) {
	tokens, err := domain.ParseStaticTokens("alpha")
	if err != nil {
		t.Fatal(err)
	}
	for name, test := range map[string]struct {
		authenticator Authenticator
		want          bool
	}{
		"disabled":      {NewAuthenticator(nil, nil), false},
		"static tokens": {NewAuthenticator(tokens, nil), true},
		"oauth only":    {NewAuthenticator(nil, &recordingVerifier{}), true},
	} {
		if got := test.authenticator.Required(); got != test.want {
			t.Errorf("%s: Required() = %v, want %v", name, got, test.want)
		}
	}
}
