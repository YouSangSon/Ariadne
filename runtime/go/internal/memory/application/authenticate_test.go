package application

import (
	"context"
	"testing"
)

type fixedVerifier OAuthIdentity

func (v fixedVerifier) Verify(context.Context, string) (OAuthIdentity, bool) {
	return OAuthIdentity(v), true
}

// Node throws on a blank verifier organization; Go rejects the credential instead of running unbound.
func TestAuthenticateRejectsBlankVerifierOrganization(t *testing.T) {
	authenticator := NewAuthenticator(nil, fixedVerifier{Organization: " \t　", Scopes: []string{"akasha:read"}})
	if principal, ok := authenticator.Authenticate(context.Background(), "Bearer jwt-1"); ok {
		t.Fatalf("authenticated %+v with a blank organization", principal)
	}
}
