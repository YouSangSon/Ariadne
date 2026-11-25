package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"ariadne/runtime/internal/memory/application"
	"ariadne/runtime/internal/memory/domain"
)

const (
	maxJSONBodyBytes = 1_000_000
	metadataPath     = "/.well-known/oauth-protected-resource"
)

// toolRoutes is the REST surface. Like the Node server, the raw request target must match exactly.
var toolRoutes = map[string]string{
	"/v1/memory": "add_memory", "/v1/memory/search": "search_memory", "/v1/memory/context-pack": "build_context_pack",
	"/v1/memory/reindex": "reindex_memory", "/v1/memory/compact": "compact_memory", "/v1/memory/list": "list_memory",
	"/v1/memory/graph": "inspect_memory_graph", "/v1/memory/impact": "inspect_memory_impact", "/v1/memory/update": "update_memory",
	"/v1/memory/delete": "delete_memory", "/v1/memory/tag": "tag_memory", "/v1/audit/list": "list_audit_log",
	"/v1/memory/unarchive": "unarchive_memory", "/v1/goal-run/start": "start_goal_run", "/v1/goal-run/iteration": "record_iteration",
	"/v1/goal-run/get": "get_goal_run", "/v1/goal-run/list": "list_goal_runs", "/v1/goal-run/complete": "complete_goal_run",
	"/v1/goal-run/abandon": "abandon_goal_run", "/v1/goal-run/context": "build_goal_context", "/v1/goal-run/check-repeat": "check_repeat_attempt",
}

// LoopbackMCPHosts is the Host allowlist for /mcp when the server binds a loopback address.
var LoopbackMCPHosts = []string{"localhost", "127.0.0.1", "[::1]"}

var loopbackOrigins = []string{"localhost", "127.0.0.1", "::1"}

// ToolExecutor runs an authorized tool call; principal is nil when authentication is disabled.
type ToolExecutor func(ctx context.Context, principal *domain.Principal, tool string, input map[string]json.RawMessage) (any, error)

// RequestError rejects a request with a client status and message.
type RequestError struct {
	Status  int
	Message string
}

func (e *RequestError) Error() string { return e.Message }

type Options struct {
	Authenticator application.Authenticator
	// Resource and Metadata are nil when OAuth is not configured; Metadata is the well-known JSON document.
	Resource *domain.ProtectedResource
	Metadata []byte
	Execute  ToolExecutor
	// MCP serves /mcp after the gate; PrincipalFromContext returns the authenticated caller.
	MCP http.Handler
	// MCPAllowedHosts validates the Host header for /mcp; nil disables the check.
	MCPAllowedHosts []string
	Logger          *slog.Logger
}

type principalKey struct{}

func PrincipalFromContext(ctx context.Context) (domain.Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(domain.Principal)
	return principal, ok
}

type handler struct{ Options }

func NewHandler(options Options) http.Handler {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	return handler{options}
}

func (h handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := requestPath(r.RequestURI)
	if r.Method == http.MethodGet && h.Resource != nil && (path == metadataPath || path == metadataPath+"/mcp") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(h.Metadata) // a failed write means the client is gone
		return
	}
	if r.RequestURI == "/mcp" {
		h.serveMCP(w, r)
		return
	}
	principal, ok := h.authenticate(r)
	if !ok {
		if strings.HasPrefix(path, "/v1/") {
			h.challenge(w)
		}
		h.writeFailure(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	tool, found := toolRoutes[r.RequestURI]
	if !found || r.Method != http.MethodPost {
		h.writeFailure(w, http.StatusNotFound, "not found")
		return
	}
	h.serveTool(w, r, principal, tool)
}

// authenticate returns a nil principal and true when no credential source is configured.
func (h handler) authenticate(r *http.Request) (*domain.Principal, bool) {
	if !h.Authenticator.Required() {
		return nil, true
	}
	principal, ok := h.Authenticator.Authenticate(r.Context(), latin1(r.Header.Get("Authorization")))
	if !ok {
		return nil, false
	}
	return &principal, true
}

func (h handler) challenge(w http.ResponseWriter) {
	if h.Resource != nil {
		w.Header().Set("WWW-Authenticate", h.Resource.Challenge())
	}
}

func (h handler) serveTool(w http.ResponseWriter, r *http.Request, principal *domain.Principal, tool string) {
	data, err := io.ReadAll(io.LimitReader(r.Body, maxJSONBodyBytes+1))
	if err != nil {
		h.internalError(w, tool, err)
		return
	}
	input, rejected := parseObject(data)
	if rejected != nil {
		h.writeFailure(w, rejected.Status, rejected.Message)
		return
	}
	var bound domain.OrganizationID
	if principal != nil {
		bound = principal.Organization
	}
	var headerValues []string
	for _, value := range r.Header.Values("X-Organization-Id") {
		headerValues = append(headerValues, latin1(value))
	}
	organization, err := domain.ResolveOrganization(headerValues, input["organizationId"], bound)
	var invalid *domain.OrganizationError
	switch {
	case errors.As(err, &invalid):
		h.writeFailure(w, http.StatusBadRequest, invalid.Message)
		return
	case errors.Is(err, domain.ErrOrganizationMismatch):
		h.writeFailure(w, http.StatusForbidden, err.Error())
		return
	case err != nil:
		h.internalError(w, tool, err)
		return
	}
	if organization != "" {
		input = domain.WithOrganization(input, organization)
	}
	challenge, err := domain.CheckScopes(principal, tool, input, h.Resource)
	if err != nil {
		h.internalError(w, tool, err)
		return
	}
	if challenge != nil {
		if h.Resource != nil {
			w.Header().Set("WWW-Authenticate", h.Resource.InsufficientScope(challenge.Scope))
		}
		h.writeFailure(w, http.StatusForbidden, "insufficient_scope")
		return
	}
	result, err := h.Execute(r.Context(), principal, tool, input)
	if errors.As(err, &rejected) {
		h.writeFailure(w, rejected.Status, rejected.Message)
		return
	}
	if err != nil {
		h.internalError(w, tool, err)
		return
	}
	h.writeJSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
		Data    any  `json:"data"`
	}{true, result})
}

// parseObject applies the Node body limit and requires a top-level JSON object.
func parseObject(data []byte) (map[string]json.RawMessage, *RequestError) {
	if len(data) > maxJSONBodyBytes {
		return nil, &RequestError{http.StatusBadRequest, "request body exceeds 1 MB"}
	}
	if len(data) == 0 {
		return nil, &RequestError{http.StatusBadRequest, "request body must be a JSON object"}
	}
	if !json.Valid(data) {
		return nil, &RequestError{http.StatusBadRequest, "invalid JSON body"}
	}
	if bytes.TrimLeft(data, " \t\r\n")[0] != '{' {
		return nil, &RequestError{http.StatusBadRequest, "request body must be a JSON object"}
	}
	var input map[string]json.RawMessage
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, &RequestError{http.StatusBadRequest, "invalid JSON body"}
	}
	return input, nil
}

func (h handler) serveMCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet && r.Method != http.MethodDelete {
		h.writeRPCError(w, http.StatusMethodNotAllowed, -32000, "Method not allowed")
		return
	}
	if len(h.MCPAllowedHosts) > 0 {
		if message := hostError(latin1(r.Host), h.MCPAllowedHosts); message != "" {
			h.writeRPCError(w, http.StatusForbidden, -32000, message)
			return
		}
	}
	if !allowedOrigin(latin1(strings.Join(r.Header.Values("Origin"), ", "))) {
		h.writeRPCError(w, http.StatusForbidden, -32000, "Forbidden origin")
		return
	}
	principal, ok := h.authenticate(r)
	if !ok {
		h.challenge(w)
		h.writeRPCError(w, http.StatusUnauthorized, -32001, "Unauthorized")
		return
	}
	ctx := r.Context()
	if principal != nil {
		ctx = context.WithValue(ctx, principalKey{}, *principal)
	}
	h.MCP.ServeHTTP(w, r.WithContext(ctx))
}

// hostError mirrors new URL("http://" + host).hostname, which brackets IPv6 and lowercases names.
func hostError(host string, allowed []string) string {
	if host == "" {
		return "Missing Host header"
	}
	parsed, err := url.Parse("http://" + host)
	if err != nil || parsed.Hostname() == "" {
		return "Invalid Host header: " + host
	}
	hostname := strings.ToLower(parsed.Hostname())
	if strings.Contains(hostname, ":") {
		hostname = "[" + hostname + "]"
	}
	if !slices.Contains(allowed, hostname) {
		return "Invalid Host: " + hostname
	}
	return ""
}

func allowedOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if address, err := netip.ParseAddr(hostname); err == nil && address.Is6() {
		hostname = address.String()
	}
	return slices.Contains(loopbackOrigins, hostname)
}

// requestPath mirrors new URL(target, "http://localhost").pathname for origin-form targets.
func requestPath(target string) string {
	if end := strings.IndexAny(target, "?#"); end >= 0 {
		target = target[:end]
	}
	segments := strings.Split(strings.ReplaceAll(target, `\`, "/"), "/")
	var kept []string
	for index, segment := range segments[1:] {
		last := index == len(segments)-2
		switch strings.ToLower(segment) {
		case ".", "%2e":
		case "..", ".%2e", "%2e.", "%2e%2e":
			if len(kept) > 0 {
				kept = kept[:len(kept)-1]
			}
		default:
			kept = append(kept, segment)
			continue
		}
		if last {
			kept = append(kept, "")
		}
	}
	return "/" + strings.Join(kept, "/")
}

// latin1 decodes header bytes the way Node exposes them: one code point per byte.
func latin1(value string) string {
	ascii := true
	for index := 0; index < len(value); index++ {
		ascii = ascii && value[index] < utf8.RuneSelf
	}
	if ascii {
		return value
	}
	decoded := make([]rune, len(value))
	for index := 0; index < len(value); index++ {
		decoded[index] = rune(value[index])
	}
	return string(decoded)
}

func (h handler) internalError(w http.ResponseWriter, tool string, err error) {
	h.Logger.Error("memory tool request failed", "tool", tool, "err", err)
	h.writeFailure(w, http.StatusInternalServerError, "internal server error")
}

func (h handler) writeFailure(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, struct {
		Success bool `json:"success"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}{Success: false, Error: struct {
		Message string `json:"message"`
	}{message}})
}

func (h handler) writeRPCError(w http.ResponseWriter, status int, code int, message string) {
	type rpcError struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	h.writeJSON(w, status, struct {
		JSONRPC string   `json:"jsonrpc"`
		Error   rpcError `json:"error"`
		ID      any      `json:"id"`
	}{"2.0", rpcError{code, message}, nil})
}

func (h handler) writeJSON(w http.ResponseWriter, status int, value any) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		h.Logger.Error("memory response encoding failed", "err", err)
		status, buffer = http.StatusInternalServerError, *bytes.NewBufferString(`{"success":false,"error":{"message":"internal server error"}}` + "\n")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))) // a failed write means the client is gone
}
