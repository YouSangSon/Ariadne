package application

import (
	"context"

	"ariadne/runtime/internal/memory/domain"
)

// OAuthIdentity is what a verified access token grants; Organization is zero when the token carries none.
// Authenticate trims a returned organization and rejects a blank one, as Node normalizes verifier results.
type OAuthIdentity struct {
	Organization domain.OrganizationID
	Scopes       []string
}

// OAuthVerifier reports whether an access token is valid for this resource. Every failure is a rejection.
type OAuthVerifier interface {
	Verify(ctx context.Context, token string) (OAuthIdentity, bool)
}

// Authenticator accepts a configured static token first and otherwise asks the OAuth verifier.
type Authenticator struct {
	tokens   []domain.StaticToken
	verifier OAuthVerifier
}

// NewAuthenticator takes a nil verifier when OAuth validation is not configured.
func NewAuthenticator(tokens []domain.StaticToken, verifier OAuthVerifier) Authenticator {
	return Authenticator{tokens: tokens, verifier: verifier}
}

// Required reports whether requests must authenticate; with neither credential source the server is open.
func (a Authenticator) Required() bool { return len(a.tokens) > 0 || a.verifier != nil }

func (a Authenticator) Authenticate(ctx context.Context, authorization string) (domain.Principal, bool) {
	credential, ok := domain.BearerCredential(authorization)
	if !ok {
		return domain.Principal{}, false
	}
	if principal, matched := domain.MatchStaticToken(credential, a.tokens); matched {
		return principal, true
	}
	if a.verifier == nil {
		return domain.Principal{}, false
	}
	identity, verified := a.verifier.Verify(ctx, credential)
	if !verified {
		return domain.Principal{}, false
	}
	principal := domain.Principal{Token: credential, Type: domain.OAuthAuth, Scopes: identity.Scopes}
	if identity.Organization != "" {
		if principal.Organization, verified = domain.ParseOrganizationID(string(identity.Organization)); !verified {
			return domain.Principal{}, false
		}
	}
	return principal, true
}
