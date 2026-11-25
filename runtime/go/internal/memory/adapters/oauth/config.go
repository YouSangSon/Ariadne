// Package oauth ports the Node Memory OAuth protected-resource configuration and its JWT access-token verifier.
package oauth

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"ariadne/runtime/internal/memory/domain"
)

const (
	wellKnownBase                = "/.well-known/oauth-protected-resource"
	defaultClockToleranceSeconds = 60
	defaultJWKSTimeoutMs         = 5000
	maxTimerTimeoutMs            = 2_147_483_647
	maxSafeInteger               = 1<<53 - 1
	defaultOrganizationClaim     = "organization_id"
)

var (
	defaultScopes     = []string{"akasha:memory"}
	defaultAlgorithms = []string{"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"}
)

// Metadata is the oauth-protected-resource well-known document, in Node's field names and order.
type Metadata struct {
	Resource               HTTPSURL   `json:"resource"`
	AuthorizationServers   []HTTPSURL `json:"authorization_servers"`
	BearerMethodsSupported []string   `json:"bearer_methods_supported"`
	ScopesSupported        []string   `json:"scopes_supported"`
	ResourceName           string     `json:"resource_name,omitempty"`
	ResourceDocumentation  HTTPSURL   `json:"resource_documentation,omitzero"`
}

// Config is the enabled OAuth configuration; its JSON form is Node's OAuthProtectedResourceConfig.
type Config struct {
	Metadata    Metadata       `json:"metadata"`
	MetadataURL string         `json:"metadataUrl"`
	Verifier    VerifierConfig `json:"-"`
}

func (c *Config) ProtectedResource() domain.ProtectedResource {
	return domain.ProtectedResource{MetadataURL: c.MetadataURL, ScopesSupported: c.Metadata.ScopesSupported}
}

type IssuerConfig struct {
	AuthorizationServer HTTPSURL `json:"authorizationServer"`
	IssuerCandidates    []string `json:"issuerCandidates"`
	MetadataURLs        []string `json:"metadataUrls"`
	JWKSURL             HTTPSURL `json:"jwksUrl,omitzero"`
}

// VerifierConfig is Node's OAuthTokenVerifierConfig; a zero JWKSURL means the issuer's JWKS URL is discovered.
type VerifierConfig struct {
	Resource              HTTPSURL       `json:"resource"`
	Issuers               []IssuerConfig `json:"issuers"`
	Algorithms            []string       `json:"algorithms"`
	ClockToleranceSeconds int64          `json:"clockToleranceSeconds"`
	OrganizationClaim     string         `json:"organizationClaim"`
	RequiredType          string         `json:"requiredType,omitempty"`
	JWKSTimeoutMs         int64          `json:"jwksTimeoutMs"`
}

// LoadConfig reads the MCP_OAUTH_* environment in Node's order and returns nil when OAuth is disabled.
func LoadConfig(lookup func(string) (string, bool)) (*Config, error) {
	servers, err := commaList(lookup, "MCP_OAUTH_AUTHORIZATION_SERVERS")
	if err != nil || len(servers) == 0 {
		return nil, err
	}
	rawResource, _ := lookup("MCP_OAUTH_RESOURCE_URL")
	if trimJS(rawResource) == "" {
		return nil, errors.New("Missing required environment variable: MCP_OAUTH_RESOURCE_URL")
	}
	resource, err := parseHTTPSURL(rawResource, "MCP_OAUTH_RESOURCE_URL")
	if err != nil {
		return nil, err
	}
	if len(resource.query) > 1 {
		return nil, errors.New("Invalid MCP_OAUTH_RESOURCE_URL: URL must not include a query string")
	}
	if resource.path != "/" && resource.path != "/mcp" {
		return nil, errors.New(`Invalid MCP_OAUTH_RESOURCE_URL: path must be "/" or "/mcp"`)
	}
	scopes, err := tokenList(lookup, "MCP_OAUTH_SCOPES", defaultScopes)
	if err != nil {
		return nil, err
	}
	name, err := optionalString(lookup, "MCP_OAUTH_RESOURCE_NAME")
	if err != nil {
		return nil, err
	}
	documentation, err := optionalString(lookup, "MCP_OAUTH_RESOURCE_DOCUMENTATION_URL")
	if err != nil {
		return nil, err
	}
	authorizationServers, err := httpsURLs(servers, "MCP_OAUTH_AUTHORIZATION_SERVERS")
	if err != nil {
		return nil, err
	}
	metadata := Metadata{
		Resource:               resource,
		AuthorizationServers:   authorizationServers,
		BearerMethodsSupported: []string{"header"},
		ScopesSupported:        scopes,
		ResourceName:           name,
	}
	if documentation != "" {
		if metadata.ResourceDocumentation, err = parseHTTPSURL(documentation, "MCP_OAUTH_RESOURCE_DOCUMENTATION_URL"); err != nil {
			return nil, err
		}
	}
	verifier, err := loadVerifierConfig(lookup, resource, authorizationServers)
	if err != nil {
		return nil, err
	}
	metadataURL := resource.origin + wellKnownBase
	if resource.path == "/mcp" {
		metadataURL += "/mcp"
	}
	return &Config{Metadata: metadata, MetadataURL: metadataURL, Verifier: verifier}, nil
}

func loadVerifierConfig(lookup func(string) (string, bool), resource HTTPSURL, servers []HTTPSURL) (VerifierConfig, error) {
	jwksEntries, err := commaList(lookup, "MCP_OAUTH_JWKS_URLS")
	if err != nil {
		return VerifierConfig{}, err
	}
	jwksURLs, err := httpsURLs(jwksEntries, "MCP_OAUTH_JWKS_URLS")
	if err != nil {
		return VerifierConfig{}, err
	}
	if len(jwksURLs) > 0 && len(jwksURLs) != len(servers) {
		return VerifierConfig{}, errors.New("Invalid MCP_OAUTH_JWKS_URLS: when set, provide one JWKS URL per MCP_OAUTH_AUTHORIZATION_SERVERS entry")
	}
	algorithms, err := tokenList(lookup, "MCP_OAUTH_JWT_ALGORITHMS", defaultAlgorithms)
	if err != nil {
		return VerifierConfig{}, err
	}
	tolerance, err := nonNegativeInteger(lookup, "MCP_OAUTH_JWT_CLOCK_TOLERANCE_SECONDS", defaultClockToleranceSeconds)
	if err != nil {
		return VerifierConfig{}, err
	}
	timeout, err := timeoutMilliseconds(lookup, "MCP_OAUTH_JWKS_TIMEOUT_MS")
	if err != nil {
		return VerifierConfig{}, err
	}
	organizationClaim, err := optionalString(lookup, "MCP_OAUTH_ORGANIZATION_CLAIM")
	if err != nil {
		return VerifierConfig{}, err
	}
	if organizationClaim == "" {
		organizationClaim = defaultOrganizationClaim
	}
	requiredType, err := optionalString(lookup, "MCP_OAUTH_JWT_TYPE")
	if err != nil {
		return VerifierConfig{}, err
	}
	issuers := make([]IssuerConfig, len(servers))
	for i, server := range servers {
		issuers[i] = IssuerConfig{AuthorizationServer: server, IssuerCandidates: issuerCandidates(server), MetadataURLs: metadataURLs(server)}
		if len(jwksURLs) > 0 {
			issuers[i].JWKSURL = jwksURLs[i]
		}
	}
	return VerifierConfig{
		Resource:              resource,
		Issuers:               issuers,
		Algorithms:            algorithms,
		ClockToleranceSeconds: tolerance,
		OrganizationClaim:     organizationClaim,
		RequiredType:          requiredType,
		JWKSTimeoutMs:         timeout,
	}, nil
}

// issuerCandidates accepts the configured URL and, when it ends in "/", the same URL without it.
func issuerCandidates(server HTTPSURL) []string {
	if trimmed, cut := strings.CutSuffix(server.href, "/"); cut {
		return []string{server.href, trimmed}
	}
	return []string{server.href}
}

// metadataURLs lists RFC 8414 and OpenID discovery locations in the order Node tries them.
func metadataURLs(server HTTPSURL) []string {
	path := strings.TrimSuffix(server.path, "/")
	if path == "" {
		return []string{server.origin + "/.well-known/oauth-authorization-server", server.origin + "/.well-known/openid-configuration"}
	}
	return []string{
		server.origin + "/.well-known/oauth-authorization-server" + path,
		server.origin + "/.well-known/openid-configuration" + path,
		server.origin + path + "/.well-known/openid-configuration",
	}
}

func trimJS(value string) string { return strings.TrimFunc(value, domain.IsJSSpace) }

func httpsURLs(values []string, name string) ([]HTTPSURL, error) {
	urls := make([]HTTPSURL, len(values))
	for i, value := range values {
		parsed, err := parseHTTPSURL(value, name)
		if err != nil {
			return nil, err
		}
		urls[i] = parsed
	}
	return urls, nil
}

// commaList is nil for an unset variable; a set value splits on "," and every trimmed entry must be non-blank.
func commaList(lookup func(string) (string, bool), name string) ([]string, error) {
	value, present := lookup(name)
	if !present {
		return nil, nil
	}
	entries := strings.Split(value, ",")
	for i, entry := range entries {
		if entries[i] = trimJS(entry); entries[i] == "" {
			return nil, errors.New("Invalid " + name + ": entries must not be blank")
		}
	}
	return entries, nil
}

// tokenList is a comma list whose entries may not contain whitespace, quotes or backslashes.
func tokenList(lookup func(string) (string, bool), name string, fallback []string) ([]string, error) {
	entries, err := commaList(lookup, name)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return slices.Clone(fallback), nil
	}
	for _, entry := range entries {
		if strings.IndexFunc(entry, domain.IsJSSpace) >= 0 || strings.ContainsAny(entry, `"\`) {
			return nil, errors.New("Invalid " + name + ` entry: "` + entry + `" contains unsupported characters`)
		}
	}
	return entries, nil
}

func optionalString(lookup func(string) (string, bool), name string) (string, error) {
	value, present := lookup(name)
	if !present {
		return "", nil
	}
	if value = trimJS(value); value == "" {
		return "", errors.New("Invalid " + name + ": must contain non-whitespace text")
	}
	return value, nil
}

// safeInteger accepts what Node's /^\d+$/ test and Number.isSafeInteger accept after trimming.
func safeInteger(raw string) (int64, bool) {
	digits := trimJS(raw)
	if !isDigits(digits) {
		return 0, false
	}
	value, err := strconv.ParseInt(digits, 10, 64)
	return value, err == nil && value <= maxSafeInteger
}

func nonNegativeInteger(lookup func(string) (string, bool), name string, fallback int64) (int64, error) {
	raw, _ := lookup(name)
	if raw == "" {
		return fallback, nil
	}
	value, ok := safeInteger(raw)
	if !ok {
		return 0, errors.New("Invalid " + name + ": expected a non-negative integer")
	}
	return value, nil
}

func timeoutMilliseconds(lookup func(string) (string, bool), name string) (int64, error) {
	raw, _ := lookup(name)
	if raw == "" {
		return defaultJWKSTimeoutMs, nil
	}
	value, ok := safeInteger(raw)
	if !ok || value == 0 {
		return 0, errors.New("Invalid " + name + ": expected a positive integer")
	}
	if value > maxTimerTimeoutMs {
		return 0, errors.New("Invalid " + name + ": expected a positive integer up to " + strconv.Itoa(maxTimerTimeoutMs))
	}
	return value, nil
}
