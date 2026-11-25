package domain

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"strings"
)

type AuthType uint8

const (
	StaticAuth AuthType = iota + 1
	OAuthAuth
)

// StaticToken is one MEMORY_API_TOKENS entry, optionally bound to an organization.
type StaticToken struct {
	secret       string
	organization OrganizationID
	digest       [sha256.Size]byte
}

// Principal is the authenticated caller. Token keys per-caller limits; Scopes apply to OAuth only.
type Principal struct {
	Token        string
	Organization OrganizationID
	Type         AuthType
	Scopes       []string
}

// ParseStaticTokens reads the comma-separated MEMORY_API_TOKENS value; "token:org" binds an organization.
func ParseStaticTokens(raw string) ([]StaticToken, error) {
	if raw == "" {
		return nil, nil
	}
	entries := strings.Split(raw, ",")
	for index, entry := range entries {
		entries[index] = jsTrim(entry)
		if entries[index] == "" {
			return nil, errors.New("Invalid MEMORY_API_TOKENS entry: entries must not be blank")
		}
	}
	tokens := make([]StaticToken, 0, len(entries))
	for _, entry := range entries {
		token, err := parseStaticToken(entry)
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, nil
}

func parseStaticToken(entry string) (StaticToken, error) {
	if strings.Count(entry, ":") > 1 {
		return StaticToken{}, errors.New("Invalid MEMORY_API_TOKENS entry: tokens may contain at most one colon")
	}
	secret, organization, bound := strings.Cut(entry, ":")
	secret = jsTrim(secret)
	if secret == "" {
		return StaticToken{}, errors.New("Invalid MEMORY_API_TOKENS entry: token is empty")
	}
	token := StaticToken{secret: secret, digest: sha256.Sum256([]byte(secret))}
	if bound {
		parsed, ok := ParseOrganizationID(organization)
		if !ok {
			return StaticToken{}, errors.New("Invalid MEMORY_API_TOKENS entry: organization id is empty")
		}
		token.organization = parsed
	}
	return token, nil
}

// BearerCredential extracts the trimmed credential from an exact "Bearer " authorization value.
func BearerCredential(authorization string) (string, bool) {
	credential, ok := strings.CutPrefix(authorization, "Bearer ")
	credential = jsTrim(credential)
	return credential, ok && credential != ""
}

// MatchStaticToken compares fixed-width digests against every configured token and returns the first match.
func MatchStaticToken(credential string, tokens []StaticToken) (Principal, bool) {
	provided := sha256.Sum256([]byte(credential))
	matched := -1
	for index := range tokens {
		if subtle.ConstantTimeCompare(tokens[index].digest[:], provided[:]) == 1 && matched < 0 {
			matched = index
		}
	}
	if matched < 0 {
		return Principal{}, false
	}
	return Principal{Token: tokens[matched].secret, Organization: tokens[matched].organization, Type: StaticAuth}, true
}

// IsLoopbackHost reports the bind hosts that only same-machine processes can reach.
func IsLoopbackHost(host string) bool {
	return host == "127.0.0.1" || host == "localhost" || host == "::1" || strings.HasPrefix(host, "::ffff:127.")
}

// CheckBindAuthentication refuses an unauthenticated server on a host reachable from another machine.
func CheckBindAuthentication(tokenCount int, host string, oauth bool) error {
	if tokenCount > 0 || oauth || IsLoopbackHost(host) {
		return nil
	}
	return errors.New("MEMORY_API_TOKENS or OAuth token validation must be set when binding to a non-loopback host " +
		"(got host=" + host + "). Set MEMORY_API_TOKENS=<comma-separated> or " +
		"configure MCP_OAUTH_AUTHORIZATION_SERVERS + MCP_OAUTH_RESOURCE_URL, or " +
		"bind to 127.0.0.1 / localhost / ::1 for local dev.")
}

// IsJSSpace reports the ECMAScript WhiteSpace and LineTerminator set that String.prototype.trim and /\s/ match.
func IsJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func jsTrim(value string) string { return strings.TrimFunc(value, IsJSSpace) }
