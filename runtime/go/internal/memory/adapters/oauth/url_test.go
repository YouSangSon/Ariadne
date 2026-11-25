package oauth

import "testing"

// Node accepts these, but Go cannot reproduce their WHATWG serialization, so configuration must fail closed.
func TestUnsupportedURLFormsFailClosed(t *testing.T) {
	for _, raw := range []string{
		"https://[::1]/",
		"https://user@issuer.example/",
		"https://xn--bcher-kva.example/",
		"https://bücher.example/",
		"https://issuer.example%2e/",
		"https://0x7f.0.0.1/",
		"https://127.1/",
		"https://issuer.example/a b",
		"https://issuer.example/?q=<x>",
		`https://issuer.example\path`,
		"https:issuer.example/",
	} {
		_, err := parseHTTPSURL(raw, "MCP_OAUTH_AUTHORIZATION_SERVERS")
		if err == nil || err.Error() != "Invalid MCP_OAUTH_AUTHORIZATION_SERVERS: unsupported URL form" {
			t.Errorf("%q: got %v, want the unsupported URL form error", raw, err)
		}
	}
}
