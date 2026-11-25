package domain

import (
	"encoding/json"
	"errors"
)

// OrganizationID is a trimmed, non-blank organization identifier. The zero value means none.
type OrganizationID string

func ParseOrganizationID(raw string) (OrganizationID, bool) {
	trimmed := jsTrim(raw)
	return OrganizationID(trimmed), trimmed != ""
}

// OrganizationError rejects a malformed caller-supplied organization before any binding check.
type OrganizationError struct{ Message string }

func (e *OrganizationError) Error() string { return e.Message }

var ErrOrganizationMismatch = errors.New("organizationId mismatch: token is bound to a different organization")

// ResolveOrganization applies the token binding, then the x-organization-id header, then the body value.
// headerValues holds every received header field value; body is the raw organizationId member or nil.
func ResolveOrganization(headerValues []string, body json.RawMessage, bound OrganizationID) (OrganizationID, error) {
	if len(headerValues) > 1 {
		return "", &OrganizationError{"x-organization-id must be provided at most once"}
	}
	var header OrganizationID
	if len(headerValues) == 1 {
		parsed, ok := ParseOrganizationID(headerValues[0])
		if !ok {
			return "", &OrganizationError{"x-organization-id must contain non-whitespace text"}
		}
		header = parsed
	}
	var fromBody OrganizationID
	if body != nil {
		var value any
		if err := json.Unmarshal(body, &value); err != nil {
			return "", err
		}
		text, isString := value.(string)
		if !isString {
			return "", &OrganizationError{"organizationId must be a string"}
		}
		parsed, ok := ParseOrganizationID(text)
		if !ok {
			return "", &OrganizationError{"organizationId must contain non-whitespace text"}
		}
		fromBody = parsed
	}
	if bound != "" {
		if header != "" && header != bound || fromBody != "" && fromBody != bound {
			return "", ErrOrganizationMismatch
		}
		return bound, nil
	}
	if header != "" {
		return header, nil
	}
	return fromBody, nil
}

// WithOrganization returns a copy of input whose organizationId is the resolved organization.
func WithOrganization(input map[string]json.RawMessage, organization OrganizationID) map[string]json.RawMessage {
	encoded, _ := json.Marshal(string(organization)) // marshaling a string cannot fail
	enriched := make(map[string]json.RawMessage, len(input)+1)
	for key, value := range input {
		enriched[key] = value
	}
	enriched["organizationId"] = encoded
	return enriched
}

// RequireOrganization guards org-scoped reads; nil means the caller resolved no organization.
func RequireOrganization(organization *string, allowLegacyAnonymous bool, operation string) error {
	if organization == nil {
		if allowLegacyAnonymous {
			return nil
		}
		return errors.New(operation + " requires organizationId. Bind your bearer token to " +
			"an org with the `token:org` syntax in MEMORY_API_TOKENS, send the " +
			"`x-organization-id` header (or `organizationId` in the request " +
			"body), or opt into the legacy single-tenant org-blind read by " +
			"setting LEGACY_ANONYMOUS_SEARCH=true in the server's environment.")
	}
	if _, ok := ParseOrganizationID(*organization); !ok {
		return errors.New("organizationId must contain non-whitespace text")
	}
	return nil
}
