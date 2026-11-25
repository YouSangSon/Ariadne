package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"ariadne/runtime/internal/memory/application"
	"ariadne/runtime/internal/memory/domain"
)

type fixtureRequest struct {
	ID         string      `json:"id"`
	Method     string      `json:"method"`
	Target     string      `json:"target"`
	Headers    [][2]string `json:"headers"`
	Body       *string     `json:"body"`
	BodyBase64 *string     `json:"body_base64"`
	BodyRepeat *struct {
		Text   string `json:"text"`
		Count  int    `json:"count"`
		Suffix string `json:"suffix"`
	} `json:"body_repeat"`
	OmitHost         bool `json:"omit_host"`
	ExpectGatePassed bool `json:"expect_gate_passed"`
}

type fixtureScenario struct {
	ID     string `json:"id"`
	Server struct {
		Tokens      string `json:"tokens"`
		OAuthTokens map[string]struct {
			OrganizationID string   `json:"organizationId"`
			Scopes         []string `json:"scopes"`
		} `json:"oauth_tokens"`
		ProtectedResourceEnv map[string]string `json:"protected_resource_env"`
		LoopbackConfig       bool              `json:"loopback_config"`
	} `json:"server"`
	Requests []fixtureRequest `json:"requests"`
}

type fixtureVerifier map[string]application.OAuthIdentity

func (v fixtureVerifier) Verify(_ context.Context, token string) (application.OAuthIdentity, bool) {
	identity, ok := v[token]
	return identity, ok
}

func loadContract(t *testing.T, name string, target any) {
	t.Helper()
	data, err := os.ReadFile("../../../../../../contracts/memory/http-node-v1/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatal(err)
	}
}

// wireBytes turns a fixture header string into the latin1 bytes the Node oracle sent.
func wireBytes(value string) string {
	encoded := make([]byte, 0, len(value))
	for _, r := range value {
		encoded = append(encoded, byte(r))
	}
	return string(encoded)
}

func requestBody(t *testing.T, request fixtureRequest) []byte {
	t.Helper()
	switch {
	case request.BodyBase64 != nil:
		decoded, err := base64.StdEncoding.DecodeString(*request.BodyBase64)
		if err != nil {
			t.Fatal(err)
		}
		return decoded
	case request.BodyRepeat != nil:
		return []byte(strings.Repeat(request.BodyRepeat.Text, request.BodyRepeat.Count) + request.BodyRepeat.Suffix)
	case request.Body != nil:
		return []byte(*request.Body)
	}
	return nil
}

// fixtureResource derives the protected resource for the canonical URLs these scenarios configure.
func fixtureResource(env map[string]string) (*domain.ProtectedResource, []byte) {
	if env == nil {
		return nil, nil
	}
	scopes := []string{"akasha:memory"}
	if raw, ok := env["MCP_OAUTH_SCOPES"]; ok {
		scopes = strings.Split(raw, ",")
	}
	resource := env["MCP_OAUTH_RESOURCE_URL"]
	metadata, _ := json.Marshal(map[string]any{
		"resource": resource, "authorization_servers": []string{env["MCP_OAUTH_AUTHORIZATION_SERVERS"]},
		"bearer_methods_supported": []string{"header"}, "scopes_supported": scopes,
	})
	return &domain.ProtectedResource{MetadataURL: strings.TrimSuffix(resource, "/mcp") + "/.well-known/oauth-protected-resource/mcp", ScopesSupported: scopes}, metadata
}

func scenarioHandler(t *testing.T, scenario fixtureScenario, handled *any, mcpPassed *bool) http.Handler {
	t.Helper()
	tokens, err := domain.ParseStaticTokens(scenario.Server.Tokens)
	if err != nil {
		t.Fatal(err)
	}
	var verifier application.OAuthVerifier
	if scenario.Server.OAuthTokens != nil {
		identities := fixtureVerifier{}
		for token, identity := range scenario.Server.OAuthTokens {
			identities[token] = application.OAuthIdentity{Organization: domain.OrganizationID(identity.OrganizationID), Scopes: identity.Scopes}
		}
		verifier = identities
	}
	resource, metadata := fixtureResource(scenario.Server.ProtectedResourceEnv)
	options := Options{
		Authenticator: application.NewAuthenticator(tokens, verifier),
		Resource:      resource,
		Metadata:      metadata,
		Execute: func(_ context.Context, _ *domain.Principal, tool string, input map[string]json.RawMessage) (any, error) {
			observed := map[string]any{"tool": tool, "organizationId": nil, "dryRun": nil}
			gateKeys := []string{}
			for key, raw := range input {
				if slices.Contains([]string{"organizationid", "dryrun"}, strings.ToLower(key)) {
					gateKeys = append(gateKeys, key)
				}
				if key == "organizationId" || key == "dryRun" {
					var value any
					if err := json.Unmarshal(raw, &value); err != nil {
						return nil, err
					}
					observed[key] = value
				}
			}
			slices.Sort(gateKeys)
			observed["gate_keys"] = gateKeys
			*handled = observed
			return observed, nil
		},
		MCP: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			*mcpPassed = true
			w.WriteHeader(http.StatusOK)
		}),
	}
	if scenario.Server.LoopbackConfig {
		options.MCPAllowedHosts = LoopbackMCPHosts
	}
	return NewHandler(options)
}

func TestNodeHTTPContracts(t *testing.T) {
	var corpus struct {
		Scenarios []fixtureScenario `json:"scenarios"`
	}
	var expected struct {
		Scenarios []struct {
			ID       string           `json:"id"`
			Requests []map[string]any `json:"requests"`
		} `json:"scenarios"`
	}
	loadContract(t, "cases.json", &corpus)
	loadContract(t, "expected.json", &expected)
	checked := 0
	for index, scenario := range corpus.Scenarios {
		var handled any
		mcpPassed := false
		handler := scenarioHandler(t, scenario, &handled, &mcpPassed)
		for requestIndex, request := range scenario.Requests {
			want := expected.Scenarios[index].Requests[requestIndex]
			handled, mcpPassed = nil, false
			req := httptest.NewRequest(request.Method, request.Target, bytes.NewReader(requestBody(t, request)))
			req.Host = "127.0.0.1:8787"
			if request.OmitHost {
				req.Host = ""
			}
			for _, header := range request.Headers {
				if strings.EqualFold(header[0], "host") {
					req.Host = wireBytes(header[1])
					continue
				}
				req.Header.Add(header[0], wireBytes(header[1]))
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			got := map[string]any{"id": request.ID}
			if request.ExpectGatePassed {
				got["gate_passed"] = mcpPassed
			} else {
				var body any = recorder.Body.String()
				var decoded any
				if json.Unmarshal(recorder.Body.Bytes(), &decoded) == nil {
					body = decoded
				}
				optionalHeader := func(name string) any {
					if value := recorder.Header().Get(name); value != "" {
						return value
					}
					return nil
				}
				got["status"] = float64(recorder.Code)
				got["content_type"] = optionalHeader("Content-Type")
				got["www_authenticate"] = optionalHeader("WWW-Authenticate")
				got["body"] = body
				got["handler"] = handled
			}
			normalized, _ := json.Marshal(got)
			var gotJSON any
			if err := json.Unmarshal(normalized, &gotJSON); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(gotJSON, want) {
				t.Errorf("%s/%s:\n got  %v\n want %v", scenario.ID, request.ID, gotJSON, want)
			}
			checked++
		}
	}
	if checked < 60 {
		t.Fatalf("only %d HTTP cases checked", checked)
	}
}

func TestMCPGatePassesPrincipal(t *testing.T) {
	tokens, err := domain.ParseStaticTokens("alpha:dev-team")
	if err != nil {
		t.Fatal(err)
	}
	var seen domain.Principal
	var found bool
	handler := NewHandler(Options{
		Authenticator: application.NewAuthenticator(tokens, nil),
		MCP: http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			seen, found = PrincipalFromContext(r.Context())
		}),
	})
	request := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	request.Header.Set("Authorization", "Bearer alpha")
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if !found || seen.Organization != "dev-team" || seen.Type != domain.StaticAuth {
		t.Fatalf("MCP handler saw %+v (found %v), want the dev-team static principal", seen, found)
	}
}
