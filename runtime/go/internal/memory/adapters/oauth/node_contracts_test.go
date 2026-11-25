package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

const contractDir = "../../../../../../contracts/memory/oauth-node-v1/"

type reply struct {
	Status int             `json:"status"`
	JWKS   *string         `json:"jwks"`
	JSON   json.RawMessage `json:"json"`
	Body   *string         `json:"body"`
}

type jwksEntry struct {
	Key     string         `json:"key"`
	Kid     *string        `json:"kid"`
	Members map[string]any `json:"members"`
	Private bool           `json:"private"`
}

type step struct {
	Advance int64  `json:"advance"`
	Token   string `json:"token"`
}

type contractCase struct {
	ID        string             `json:"id"`
	Op        string             `json:"op"`
	Env       map[string]*string `json:"env"`
	Responses map[string][]reply `json:"responses"`
	Steps     []step             `json:"steps"`
}

type corpus struct {
	Now              int64                  `json:"now"`
	DefaultEnv       map[string]*string     `json:"default_env"`
	DefaultResponses map[string][]reply     `json:"default_responses"`
	JWKS             map[string][]jwksEntry `json:"jwks"`
	Cases            []contractCase         `json:"cases"`
}

type material struct {
	Keys        map[string]map[string]any `json:"keys"`
	PrivateJWKs map[string]map[string]any `json:"private_jwks"`
	Tokens      map[string]string         `json:"tokens"`
}

type fetch struct {
	URL    string `json:"url"`
	Accept string `json:"accept"`
}

// fixtureTransport serves replies per URL in order, repeats the last one, and fails the transport for an empty list.
type fixtureTransport struct {
	corpus    *corpus
	material  *material
	responses map[string][]reply
	mu        sync.Mutex
	served    map[string]int
	fetches   []fetch
}

func newFixtureTransport(c *corpus, m *material, overrides map[string][]reply) *fixtureTransport {
	responses := maps.Clone(c.DefaultResponses)
	maps.Copy(responses, overrides)
	return &fixtureTransport{corpus: c, material: m, responses: responses, served: map[string]int{}}
}

func (f *fixtureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	url := req.URL.String()
	f.fetches = append(f.fetches, fetch{URL: url, Accept: req.Header.Get("Accept")})
	replies := f.responses[url]
	if len(replies) == 0 {
		return nil, errors.New("fetch failed")
	}
	served := min(f.served[url], len(replies)-1)
	f.served[url]++
	return &http.Response{
		StatusCode: replies[served].Status,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(f.body(replies[served]))),
		Request:    req,
	}, nil
}

func (f *fixtureTransport) body(r reply) string {
	switch {
	case r.JWKS != nil:
		keys := []map[string]any{}
		for _, entry := range f.corpus.JWKS[*r.JWKS] {
			source := f.material.Keys[entry.Key]
			if entry.Private {
				source = f.material.PrivateJWKs[entry.Key]
			}
			jwk := maps.Clone(source)
			if entry.Kid != nil {
				jwk["kid"] = *entry.Kid
			}
			maps.Copy(jwk, entry.Members)
			keys = append(keys, jwk)
		}
		encoded, _ := json.Marshal(map[string]any{"keys": keys}) // fixture maps always marshal
		return string(encoded)
	case r.JSON != nil:
		return string(r.JSON)
	case r.Body != nil:
		return *r.Body
	}
	return ""
}

func (f *fixtureTransport) take() []fetch {
	f.mu.Lock()
	defer f.mu.Unlock()
	taken := f.fetches
	f.fetches = []fetch{}
	return taken
}

func readContract(t *testing.T, name string, target any) {
	t.Helper()
	data, err := os.ReadFile(contractDir + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatal(err)
	}
}

func loadFixtures(t *testing.T) (*corpus, *material) {
	t.Helper()
	var c corpus
	var m material
	readContract(t, "cases.json", &c)
	readContract(t, "material.json", &m)
	return &c, &m
}

// lookup merges the case environment over the defaults; a null value unsets the variable.
func (c *corpus) lookup(env map[string]*string) func(string) (string, bool) {
	merged := map[string]string{}
	for _, layer := range []map[string]*string{c.DefaultEnv, env} {
		for name, value := range layer {
			if value == nil {
				delete(merged, name)
			} else {
				merged[name] = *value
			}
		}
	}
	return func(name string) (string, bool) {
		value, ok := merged[name]
		return value, ok
	}
}

func normalized(t *testing.T, value any) any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func observeConfig(lookup func(string) (string, bool)) any {
	config, err := LoadConfig(lookup)
	switch {
	case err != nil:
		return map[string]any{"error": err.Error()}
	case config == nil:
		return map[string]any{"protected_resource": nil, "verifier": nil}
	}
	return map[string]any{"protected_resource": config, "verifier": config.Verifier}
}

func observeVerify(t *testing.T, c *corpus, m *material, entry contractCase) any {
	t.Helper()
	config, err := LoadConfig(c.lookup(entry.Env))
	if err != nil || config == nil {
		t.Fatalf("OAuth verifier must be configured: %v", err)
	}
	transport := newFixtureTransport(c, m, entry.Responses)
	clock := time.Unix(c.Now, 0)
	verifier := NewVerifier(config.Verifier, &http.Client{Transport: transport}, func() time.Time { return clock })
	steps := []any{}
	for _, s := range entry.Steps {
		clock = clock.Add(time.Duration(s.Advance) * time.Second)
		transport.take()
		identity, ok := verifier.Verify(context.Background(), m.Tokens[s.Token])
		observed := any(nil)
		if ok {
			organization := any(nil)
			if identity.Organization != "" {
				organization = string(identity.Organization)
			}
			observed = map[string]any{"organizationId": organization, "scopes": identity.Scopes}
		}
		steps = append(steps, map[string]any{"token": s.Token, "identity": observed, "fetches": transport.take()})
	}
	return map[string]any{"steps": steps}
}

func TestNodeOAuthContracts(t *testing.T) {
	c, m := loadFixtures(t)
	var expected struct {
		Cases []map[string]any `json:"cases"`
	}
	readContract(t, "expected.json", &expected)
	want := map[string]map[string]any{}
	for _, entry := range expected.Cases {
		id := entry["id"].(string)
		delete(entry, "id")
		want[id] = entry
	}
	if len(want) != len(c.Cases) {
		t.Fatalf("expected.json has %d cases, cases.json has %d", len(want), len(c.Cases))
	}
	for _, entry := range c.Cases {
		t.Run(entry.ID, func(t *testing.T) {
			var got any
			if entry.Op == "config" {
				got = normalized(t, observeConfig(c.lookup(entry.Env)))
			} else {
				got = normalized(t, observeVerify(t, c, m, entry))
			}
			if !reflect.DeepEqual(got, normalized(t, want[entry.ID])) {
				gotJSON, _ := json.MarshalIndent(got, "", "  ")
				wantJSON, _ := json.MarshalIndent(want[entry.ID], "", "  ")
				t.Errorf("got\n%s\nwant\n%s", gotJSON, wantJSON)
			}
		})
	}
}
