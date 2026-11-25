package oauth

import (
	"errors"
	"strconv"
	"strings"

	"ariadne/runtime/internal/memory/domain"
)

// HTTPSURL is an absolute https URL held in the serialization WHATWG new URL(x).toString() produces.
type HTTPSURL struct {
	href   string
	origin string
	path   string
	query  string // "" when absent, otherwise "?" followed by the raw query
}

func (u HTTPSURL) String() string { return u.href }

func (u HTTPSURL) MarshalText() ([]byte, error) { return []byte(u.href), nil }

type urlDefect uint8

const (
	urlSupported   urlDefect = iota
	urlUnsupported           // WHATWG may accept it, but this parser does not serialize that form
	urlInvalid               // WHATWG new URL throws
)

// specialSchemes share https's authority rules, so a parse failure there is Node's "absolute URL" error too.
var specialSchemes = map[string]bool{"http": true, "https": true, "ws": true, "wss": true, "ftp": true}

// parseHTTPSURL is Node's requireHttpsUrl for a subset of WHATWG URLs: an ASCII domain or strict dotted IPv4
// host, an optional port, and a path and query WHATWG would not percent-encode. Other forms get
// "unsupported URL form"; inputs Node itself rejects keep Node's message.
func parseHTTPSURL(raw, name string) (HTTPSURL, error) {
	// JS trim, then WHATWG's own strip of leading and trailing C0 controls and spaces.
	value := strings.TrimFunc(strings.TrimFunc(raw, domain.IsJSSpace), func(r rune) bool { return r <= ' ' })
	scheme, rest, ok := cutScheme(value)
	if !ok {
		return HTTPSURL{}, errors.New("Invalid " + name + ": expected an absolute HTTPS URL")
	}
	var parsed HTTPSURL
	var fragment string
	defect := urlUnsupported
	// WHATWG drops tabs and newlines and reads '\' as '/', so the input would not be its own serialization.
	if specialSchemes[scheme] && !strings.ContainsAny(rest, "\t\n\r\\") {
		parsed, fragment, defect = parseAuthorityURL(rest)
	}
	switch {
	case defect == urlInvalid:
		return HTTPSURL{}, errors.New("Invalid " + name + ": expected an absolute HTTPS URL")
	case scheme != "https":
		return HTTPSURL{}, errors.New("Invalid " + name + ": expected an HTTPS URL")
	case len(fragment) > 1:
		return HTTPSURL{}, errors.New("Invalid " + name + ": URL must not include a fragment")
	case defect == urlUnsupported:
		return HTTPSURL{}, errors.New("Invalid " + name + ": unsupported URL form")
	}
	return parsed, nil
}

func cutScheme(value string) (string, string, bool) {
	for i := 0; i < len(value); i++ {
		c := value[i]
		switch {
		case 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z':
		case i > 0 && c == ':':
			return strings.ToLower(value[:i]), value[i+1:], true
		case i > 0 && (isDigit(c) || c == '+' || c == '-' || c == '.'):
		default:
			return "", "", false
		}
	}
	return "", "", false
}

// parseAuthorityURL reads "//host[:port][/path][?query][#fragment]" and returns the fragment with its "#".
func parseAuthorityURL(rest string) (HTTPSURL, string, urlDefect) {
	rest, ok := strings.CutPrefix(rest, "//")
	if !ok || strings.HasPrefix(rest, "/") {
		return HTTPSURL{}, "", urlUnsupported
	}
	rest, fragment, hasFragment := strings.Cut(rest, "#")
	if hasFragment {
		fragment = "#" + fragment
	}
	rest, query, hasQuery := strings.Cut(rest, "?")
	if hasQuery {
		query = "?" + query
	}
	authority, path := rest, ""
	if slash := strings.IndexByte(rest, '/'); slash >= 0 {
		authority, path = rest[:slash], rest[slash:]
	}
	if strings.Contains(authority, "@") || strings.HasPrefix(authority, "[") {
		return HTTPSURL{}, "", urlUnsupported // userinfo or an IPv6 literal
	}
	rawHost, rawPort, _ := strings.Cut(authority, ":")
	host, hostDefect := parseHost(rawHost)
	port, portDefect := parsePort(rawPort)
	path, pathDefect := resolvePath(path)
	defect := max(hostDefect, portDefect, pathDefect, encodedDefect(query, "\"'<>"))
	origin := "https://" + host + port
	return HTTPSURL{href: origin + path + query + fragment, origin: origin, path: path, query: query}, fragment, defect
}

func parseHost(raw string) (string, urlDefect) {
	if raw == "" {
		return "", urlInvalid
	}
	defect := urlSupported
	host := []byte(raw)
	for i, c := range host {
		switch {
		case 'A' <= c && c <= 'Z':
			host[i] = c + 'a' - 'A'
		case 'a' <= c && c <= 'z' || isDigit(c) || c == '-' || c == '_' || c == '.':
		case c <= ' ' || c == 0x7f || strings.IndexByte("<>[]^|", c) >= 0:
			return "", urlInvalid // forbidden domain code points
		default:
			defect = urlUnsupported // percent-encoded, punctuation or non-ASCII hosts go through IDNA
		}
	}
	labels := strings.Split(string(host), ".")
	for _, label := range labels {
		if strings.HasPrefix(label, "xn--") {
			defect = urlUnsupported
		}
	}
	last := labels[len(labels)-1]
	if last == "" && len(labels) > 1 {
		last = labels[len(labels)-2]
	}
	// A host ending in a number goes through WHATWG's IPv4 parser; only the canonical dotted form is kept.
	endsInNumber := isDigits(last) || strings.HasPrefix(last, "0x") && strings.Trim(last[2:], "0123456789abcdef") == ""
	if endsInNumber && !isStrictIPv4(labels) {
		defect = urlUnsupported
	}
	return string(host), defect
}

func isStrictIPv4(labels []string) bool {
	if len(labels) != 4 {
		return false
	}
	for _, label := range labels {
		value, err := strconv.Atoi(label)
		if !isDigits(label) || err != nil || value > 255 || len(label) > 1 && label[0] == '0' {
			return false
		}
	}
	return true
}

// parsePort returns ":port" without leading zeros, or "" for no port and the https default 443.
func parsePort(raw string) (string, urlDefect) {
	if raw == "" {
		return "", urlSupported
	}
	if !isDigits(raw) {
		return "", urlInvalid
	}
	trimmed := strings.TrimLeft(raw, "0")
	if trimmed == "" {
		trimmed = "0"
	}
	if value, err := strconv.Atoi(trimmed); err != nil || value > 65535 {
		return "", urlInvalid
	}
	if trimmed == "443" {
		return "", urlSupported
	}
	return ":" + trimmed, urlSupported
}

// resolvePath applies WHATWG's dot-segment rules, including the "%2e" spellings, to a path that starts with "/".
func resolvePath(path string) (string, urlDefect) {
	if path == "" {
		return "/", urlSupported
	}
	segments := strings.Split(path[1:], "/")
	resolved := make([]string, 0, len(segments))
	for i, segment := range segments {
		last := i == len(segments)-1
		switch strings.ReplaceAll(strings.ToLower(segment), "%2e", ".") {
		case "..":
			if len(resolved) > 0 {
				resolved = resolved[:len(resolved)-1]
			}
			if last {
				resolved = append(resolved, "")
			}
		case ".":
			if last {
				resolved = append(resolved, "")
			}
		default:
			resolved = append(resolved, segment)
		}
	}
	return "/" + strings.Join(resolved, "/"), encodedDefect(path, "\"<>^`{}")
}

// encodedDefect flags bytes WHATWG would percent-encode: controls, space, non-ASCII and the given set.
func encodedDefect(component, set string) urlDefect {
	for i := 0; i < len(component); i++ {
		if c := component[i]; c <= ' ' || c > '~' || strings.IndexByte(set, c) >= 0 {
			return urlUnsupported
		}
	}
	return urlSupported
}

func isDigit(c byte) bool { return '0' <= c && c <= '9' }

func isDigits(value string) bool {
	return value != "" && strings.Trim(value, "0123456789") == ""
}
