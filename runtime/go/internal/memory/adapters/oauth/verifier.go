package oauth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"ariadne/runtime/internal/memory/application"
	"ariadne/runtime/internal/memory/domain"
)

const (
	discoveryAccept = "application/json"
	jwksAccept      = "application/json, application/jwk-set+json"
	jwksMaxAge      = 10 * time.Minute // jose createRemoteJWKSet cacheMaxAge
	jwksCooldown    = 30 * time.Second // jose createRemoteJWKSet cooldownDuration
)

// Verifier checks JWT access tokens against each issuer's remote JWKS, in Node's order of checks:
// decode, issuer, discovery, header, JWKS, key, signature, b64, claims, then scopes and organization.
type Verifier struct {
	config  VerifierConfig
	client  *http.Client
	now     func() time.Time
	issuers []*issuerState
}

// issuerState caches one issuer's discovered JWKS URL and key set. fetch serializes its network loads, and a
// caller that queued behind a load takes that load's result, failure included, as jose shares a pending fetch.
type issuerState struct {
	config            IssuerConfig
	fetch             sync.Mutex
	mu                sync.Mutex
	jwksURL           string
	failedDiscoveries uint64 // a successful discovery sets jwksURL instead
	keys              []map[string]any
	fetchedAt         time.Time // zero until a JWKS load succeeds
	loads             uint64    // finished JWKS loads, failed ones included
	loadFailed        bool
}

// NewVerifier never follows redirects and bounds discovery with the JWKS timeout, which Node leaves unbounded.
func NewVerifier(config VerifierConfig, client *http.Client, now func() time.Time) *Verifier {
	noRedirects := *client
	noRedirects.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	issuers := make([]*issuerState, len(config.Issuers))
	for i, issuer := range config.Issuers {
		issuers[i] = &issuerState{config: issuer, jwksURL: issuer.JWKSURL.String()}
	}
	return &Verifier{config: config, client: &noRedirects, now: now, issuers: issuers}
}

func (v *Verifier) Verify(ctx context.Context, token string) (application.OAuthIdentity, bool) {
	segments := strings.Split(token, ".")
	if len(segments) != 3 || segments[1] == "" {
		return application.OAuthIdentity{}, false
	}
	claims, ok := decodeSegment(segments[1])
	if !ok {
		return application.OAuthIdentity{}, false
	}
	issuerClaim, _ := claims["iss"].(string)
	issuer := v.findIssuer(issuerClaim)
	if issuer == nil {
		return application.OAuthIdentity{}, false
	}
	jwksURL, ok := v.jwksURL(ctx, issuer)
	if !ok {
		return application.OAuthIdentity{}, false
	}
	header, ok := decodeSegment(segments[0])
	if !ok {
		return application.OAuthIdentity{}, false
	}
	b64, ok := checkCrit(header)
	alg, _ := header["alg"].(string)
	if !ok || alg == "" || !slices.Contains(v.config.Algorithms, alg) {
		return application.OAuthIdentity{}, false
	}
	entry, key, ok := v.selectKey(ctx, issuer, jwksURL, header, alg)
	if !ok {
		return application.OAuthIdentity{}, false
	}
	signature, ok := decodeBase64URL(segments[2])
	if !ok || !verifySignature(entry, key, []byte(segments[0]+"."+segments[1]), signature) || !b64 {
		return application.OAuthIdentity{}, false
	}
	if !v.claimsValid(header, claims) {
		return application.OAuthIdentity{}, false
	}
	organization, ok := organizationClaim(claims, v.config.OrganizationClaim)
	return application.OAuthIdentity{Organization: organization, Scopes: scopes(claims)}, ok
}

func (v *Verifier) findIssuer(iss string) *issuerState {
	for _, issuer := range v.issuers {
		if slices.Contains(issuer.config.IssuerCandidates, iss) {
			return issuer
		}
	}
	return nil
}

// jwksURL returns the configured or discovered JWKS URL. Only a successful discovery is remembered; a failed
// attempt fails just the callers that queued behind it.
func (v *Verifier) jwksURL(ctx context.Context, issuer *issuerState) (string, bool) {
	url, seen := issuer.discovered()
	if url != "" {
		return url, true
	}
	issuer.fetch.Lock()
	defer issuer.fetch.Unlock()
	if url, failures := issuer.discovered(); url != "" || failures != seen {
		return url, url != ""
	}
	for _, metadataURL := range issuer.config.MetadataURLs {
		if url, ok := v.discover(ctx, metadataURL); ok {
			issuer.mu.Lock()
			issuer.jwksURL = url
			issuer.mu.Unlock()
			return url, true
		}
	}
	issuer.mu.Lock()
	issuer.failedDiscoveries++
	issuer.mu.Unlock()
	return "", false
}

func (s *issuerState) discovered() (string, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jwksURL, s.failedDiscoveries
}

func (v *Verifier) discover(ctx context.Context, metadataURL string) (string, bool) {
	status, body, ok := v.get(ctx, metadataURL, discoveryAccept)
	var document map[string]any
	if !ok || status < 200 || status > 299 || decodeBody(body, &document) != nil {
		return "", false
	}
	raw, ok := document["jwks_uri"].(string)
	if !ok {
		return "", false
	}
	url, err := parseHTTPSURL(raw, "jwks_uri")
	return url.String(), err == nil
}

// selectKey is jose's remote JWK Set: load when unloaded or stale, then refetch once for an unmatched key
// when the last load is older than the cooldown. Exactly one usable key must remain.
func (v *Verifier) selectKey(ctx context.Context, issuer *issuerState, jwksURL string, header map[string]any, alg string) (algorithm, any, bool) {
	keys, fetchedAt, loads := issuer.snapshot()
	if fetchedAt.IsZero() || !v.now().Before(fetchedAt.Add(jwksMaxAge)) {
		var ok bool
		if keys, fetchedAt, loads, ok = v.reload(ctx, issuer, jwksURL, loads); !ok {
			return algorithm{}, nil, false
		}
	}
	entry, known := algorithms[alg]
	if !known {
		return algorithm{}, nil, false
	}
	candidates := usableKeys(keys, entry, alg, header)
	if len(candidates) == 0 && !v.now().Before(fetchedAt.Add(jwksCooldown)) {
		var ok bool
		if keys, _, _, ok = v.reload(ctx, issuer, jwksURL, loads); !ok {
			return algorithm{}, nil, false
		}
		candidates = usableKeys(keys, entry, alg, header)
	}
	if len(candidates) != 1 {
		return algorithm{}, nil, false
	}
	key, ok := importPublicKey(candidates[0], entry)
	return entry, key, ok
}

func usableKeys(keys []map[string]any, entry algorithm, alg string, header map[string]any) []map[string]any {
	var usable []map[string]any
	for _, jwk := range keys {
		if usableJWK(jwk, entry, alg, header) {
			usable = append(usable, jwk)
		}
	}
	return usable
}

func (s *issuerState) snapshot() ([]map[string]any, time.Time, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.keys, s.fetchedAt, s.loads
}

// reload fetches the JWK Set unless a load finished after seen, whose result it returns; a failed load keeps
// the old set.
func (v *Verifier) reload(ctx context.Context, issuer *issuerState, jwksURL string, seen uint64) ([]map[string]any, time.Time, uint64, bool) {
	issuer.fetch.Lock()
	defer issuer.fetch.Unlock()
	if keys, fetchedAt, loads := issuer.snapshot(); loads != seen {
		return keys, fetchedAt, loads, !issuer.loadFailed // loadFailed changes only under fetch
	}
	keys, ok := v.fetchKeys(ctx, jwksURL)
	issuer.mu.Lock()
	defer issuer.mu.Unlock()
	issuer.loads++
	issuer.loadFailed = !ok
	if ok {
		issuer.keys, issuer.fetchedAt = keys, v.now()
	}
	return issuer.keys, issuer.fetchedAt, issuer.loads, ok
}

// fetchKeys accepts only a 200 response holding a JSON object whose "keys" is an array of objects.
func (v *Verifier) fetchKeys(ctx context.Context, jwksURL string) ([]map[string]any, bool) {
	status, body, ok := v.get(ctx, jwksURL, jwksAccept)
	var document map[string]any
	if !ok || status != http.StatusOK || decodeBody(body, &document) != nil {
		return nil, false
	}
	members, ok := document["keys"].([]any)
	if !ok {
		return nil, false
	}
	keys := make([]map[string]any, len(members))
	for i, member := range members {
		if keys[i], ok = member.(map[string]any); !ok {
			return nil, false
		}
	}
	return keys, true
}

// get bounds the whole exchange, body included, by the JWKS timeout. Like jose's fetch it ignores the caller's
// cancellation, because callers queued behind this load take its result.
func (v *Verifier) get(ctx context.Context, url, accept string) (int, []byte, bool) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Duration(v.config.JWKSTimeoutMs)*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, nil, false
	}
	request.Header.Set("Accept", accept)
	response, err := v.client.Do(request)
	if err != nil {
		return 0, nil, false
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	return response.StatusCode, body, err == nil
}

// decodeBody is Response.json(): one leading BOM is dropped before JSON parsing.
func decodeBody(body []byte, target any) error {
	return json.Unmarshal(bytes.TrimPrefix(body, utf8BOM), target)
}

// claimsValid is jose's validateClaimsSet for the options Node passes; iss already matched the issuer.
func (v *Verifier) claimsValid(header, claims map[string]any) bool {
	if v.config.RequiredType != "" {
		typ, ok := header["typ"].(string)
		if !ok || !isASCII(typ) || !isASCII(v.config.RequiredType) || normalizeTyp(typ) != normalizeTyp(v.config.RequiredType) {
			return false
		}
	}
	if !audienceMatches(claims["aud"], v.config.Resource.String()) {
		return false
	}
	now := float64(v.now().Unix())
	tolerance := float64(v.config.ClockToleranceSeconds)
	if _, ok := numericDate(claims, "iat"); !ok {
		return false
	}
	nbf, ok := numericDate(claims, "nbf")
	if !ok || nbf != nil && *nbf > now+tolerance {
		return false
	}
	exp, ok := numericDate(claims, "exp")
	return ok && (exp == nil || *exp > now-tolerance)
}

// numericDate is nil for an absent claim and fails for a present non-number.
func numericDate(claims map[string]any, name string) (*float64, bool) {
	raw, present := claims[name]
	if !present {
		return nil, true
	}
	value, ok := jsNumber(raw)
	return &value, ok
}

func audienceMatches(aud any, resource string) bool {
	switch value := aud.(type) {
	case string:
		return value == resource
	case []any:
		return slices.Contains(value, any(resource))
	}
	return false
}

// isASCII guards normalizeTyp: Go's simple case mapping and JavaScript's full mapping agree only on ASCII,
// so "İ" would lowercase to "i" in Go but not in Node.
func isASCII(value string) bool {
	return !strings.ContainsFunc(value, func(r rune) bool { return r >= utf8.RuneSelf })
}

func normalizeTyp(value string) string {
	lower := strings.ToLower(value)
	if strings.Contains(value, "/") {
		return lower
	}
	return "application/" + lower
}

// scopes collects unique entries of a space-separated scope and an scp string or string array.
func scopes(claims map[string]any) []string {
	collected := []string{}
	add := func(scope string) {
		if scope != "" && !slices.Contains(collected, scope) {
			collected = append(collected, scope)
		}
	}
	if scope, ok := claims["scope"].(string); ok {
		for _, entry := range strings.FieldsFunc(scope, domain.IsJSSpace) {
			add(entry)
		}
	}
	switch scp := claims["scp"].(type) {
	case string:
		for _, entry := range strings.FieldsFunc(scp, domain.IsJSSpace) {
			add(entry)
		}
	case []any:
		for _, entry := range scp {
			if text, ok := entry.(string); ok {
				add(text)
			}
		}
	}
	return collected
}

// organizationClaim is empty when absent; a present claim must be a non-blank string.
func organizationClaim(claims map[string]any, name string) (domain.OrganizationID, bool) {
	raw, present := claims[name]
	if !present {
		return "", true
	}
	text, ok := raw.(string)
	if !ok {
		return "", false
	}
	return domain.ParseOrganizationID(text)
}
