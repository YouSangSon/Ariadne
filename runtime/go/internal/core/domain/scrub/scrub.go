// Package scrub owns the ordered secret redaction policy shared with lib/scrub.mjs.
package scrub

import (
	"regexp"
	"strings"
)

type Result struct {
	Text       []uint16
	Detections []string
}
type pattern struct {
	category    string
	regex       *regexp.Regexp
	replacement string
}

const whitespace = `\x09-\x0d\x20\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

func compile(category, expression, replacement string) pattern {
	expression = strings.ReplaceAll(expression, `[\s\S]`, `(?s:.)`)
	expression = strings.ReplaceAll(expression, `[^\s`, "[^"+whitespace)
	expression = strings.ReplaceAll(expression, `\s`, "["+whitespace+"]")
	return pattern{category, regexp.MustCompile(expression), replacement}
}

var patterns = []pattern{
	compile("anthropic-key", `\bsk-ant-[A-Za-z0-9_-]{20,}`, ""),
	compile("openai-key", `\bsk-[A-Za-z0-9_-]{20,}`, ""),
	compile("stripe-key", `\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b`, ""),
	compile("github-token", `\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b`, ""),
	compile("slack-token", `\bxox[baprs]-[A-Za-z0-9-]{10,}\b`, ""),
	compile("aws-access-key", `\bAKIA[0-9A-Z]{16}\b`, ""),
	compile("aws-secret-key", `AWS_SECRET_ACCESS_KEY\s*=\s*[A-Za-z0-9/+=]{32,}`, "AWS_SECRET_ACCESS_KEY=[REDACTED_AWS_SECRET_KEY]"),
	compile("gcp-api-key", `\bAIza[0-9A-Za-z_-]{35}\b`, ""),
	compile("npm-token", `\bnpm_[A-Za-z0-9]{36}\b`, ""),
	compile("jwt", `\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`, ""),
	compile("bearer-token", `Bearer\s+[A-Za-z0-9._~+/=-]{24,}`, "Bearer [REDACTED_BEARER_TOKEN]"),
	compile("db-url", `(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?)://[^\s:@/]+:[^\s@/]+@[^\s/]+`, ""),
	compile("private-key", `-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----`, ""),
}

// Each surrogate unit maps injectively into a private scalar; all other units keep
// their regex properties. JS non-u regexes then consume exactly one UTF-16 unit.
func bridge(units []uint16) string {
	var b strings.Builder
	for _, u := range units {
		r := rune(u)
		if u >= 0xd800 && u <= 0xdfff {
			r = 0x10000 + r - 0xd800
		}
		b.WriteRune(r)
	}
	return b.String()
}
func unbridge(s string) []uint16 {
	out := []uint16{}
	for _, r := range s {
		if r >= 0x10000 && r <= 0x107ff {
			r = r - 0x10000 + 0xd800
		}
		out = append(out, uint16(r))
	}
	return out
}
func Scrub(input []uint16) Result {
	text := bridge(input)
	detections := []string{}
	for _, p := range patterns {
		if !p.regex.MatchString(text) {
			continue
		}
		replacement := p.replacement
		if replacement == "" {
			replacement = "[REDACTED_" + strings.ToUpper(strings.ReplaceAll(p.category, "-", "_")) + "]"
		}
		text = p.regex.ReplaceAllString(text, replacement)
		detections = append(detections, p.category)
	}
	return Result{unbridge(text), detections}
}
func Detect(input []uint16) []string { return Scrub(input).Detections }
