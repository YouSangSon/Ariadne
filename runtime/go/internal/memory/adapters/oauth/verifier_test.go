package oauth

import (
	"context"
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
