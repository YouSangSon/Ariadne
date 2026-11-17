package projectfiles

import (
	"errors"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"regexp"
	"strings"
)

const MaxBytes = 1024 * 1024

var protected = map[string]bool{}
var credential = regexp.MustCompile(`(?:^|[._-])(?:credentials?|secrets?)(?:$|[._-])`)
var privateKey = regexp.MustCompile(`^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|p12|pfx|key)$`)

func init() {
	for _, s := range []string{".git", ".harness", ".codex", ".claude", ".gemini", ".agents", "node_modules", ".ssh", ".aws", ".gnupg", ".netrc", ".npmrc", ".pypirc", ".mcp.json", "agents.md", "claude.md", "gemini.md"} {
		protected[s] = true
	}
}
func Path(value string) ([]string, error) {
	if value == "" || strings.Contains(value, `\`) || strings.IndexFunc(value, func(r rune) bool { return r < 32 || r == 127 }) >= 0 || len(value) >= 2 && value[1] == ':' && (value[0] >= 'a' && value[0] <= 'z' || value[0] >= 'A' && value[0] <= 'Z') {
		return nil, errors.New("Project path is denied")
	}
	parts := strings.Split(value, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return nil, errors.New("Project path must be a contained relative path")
		}
	}
	lower := cases.Lower(language.Und, cases.HandleFinalSigma(false))
	for _, part := range parts {
		name := lower.String(part)
		if protected[name] || strings.HasPrefix(name, ".env") || credential.MatchString(name) || privateKey.MatchString(name) {
			return nil, errors.New("Protected project path is denied")
		}
	}
	return parts, nil
}
