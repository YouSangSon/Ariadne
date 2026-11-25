package oauth

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"
)

// Concurrent first requests share one JWKS load, as jose's pending fetch does.
func TestConcurrentVerifyLoadsJWKSOnce(t *testing.T) {
	c, m := loadFixtures(t)
	config, err := LoadConfig(c.lookup(nil))
	if err != nil || config == nil {
		t.Fatalf("OAuth verifier must be configured: %v", err)
	}
	transport := newFixtureTransport(c, m, nil)
	verifier := NewVerifier(config.Verifier, &http.Client{Transport: transport}, func() time.Time { return time.Unix(c.Now, 0) })
	accepted := make([]bool, 16)
	var wg sync.WaitGroup
	for i := range accepted {
		wg.Go(func() { _, accepted[i] = verifier.Verify(context.Background(), m.Tokens["rs256"]) })
	}
	wg.Wait()
	for i, ok := range accepted {
		if !ok {
			t.Fatalf("request %d rejected a valid token", i)
		}
	}
	if fetches := transport.take(); len(fetches) != 1 {
		t.Fatalf("got %d JWKS fetches, want 1: %v", len(fetches), fetches)
	}
}

// slowFailingTransport fails every fetch after a delay long enough for concurrent callers to queue behind it.
type slowFailingTransport struct {
	mu      sync.Mutex
	fetches int
}

func (s *slowFailingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	s.mu.Lock()
	s.fetches++
	s.mu.Unlock()
	time.Sleep(100 * time.Millisecond)
	return nil, errors.New("fetch failed")
}

// Callers that queue behind a failing load take its failure, as jose's pending fetch rejects every waiter,
// instead of repeating the load one after another for up to the timeout each.
func TestConcurrentVerifySharesFailedLoads(t *testing.T) {
	c, m := loadFixtures(t)
	for name, env := range map[string]map[string]*string{"jwks": nil, "discovery": {"MCP_OAUTH_JWKS_URLS": nil}} {
		t.Run(name, func(t *testing.T) {
			config, err := LoadConfig(c.lookup(env))
			if err != nil || config == nil {
				t.Fatalf("OAuth verifier must be configured: %v", err)
			}
			transport := &slowFailingTransport{}
			verifier := NewVerifier(config.Verifier, &http.Client{Transport: transport}, func() time.Time { return time.Unix(c.Now, 0) })
			var wg sync.WaitGroup
			for range 16 {
				wg.Go(func() {
					if _, ok := verifier.Verify(context.Background(), m.Tokens["rs256"]); ok {
						t.Error("accepted a token with no reachable keys")
					}
				})
			}
			wg.Wait()
			want := 1
			if issuer := config.Verifier.Issuers[0]; issuer.JWKSURL.String() == "" {
				want = len(issuer.MetadataURLs)
			}
			if transport.fetches != want {
				t.Fatalf("got %d fetches, want %d from one shared attempt", transport.fetches, want)
			}
		})
	}
}
