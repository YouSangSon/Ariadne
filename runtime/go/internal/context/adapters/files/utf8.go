package contextfiles

import "golang.org/x/text/encoding/unicode"

// UTF8 (not UTF8BOM) preserves BOM and replaces each maximal malformed subpart.
func lossy(raw string) string { text, _ := unicode.UTF8.NewDecoder().String(raw); return text }
