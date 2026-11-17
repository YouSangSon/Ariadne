package ontology

import (
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
	"sort"
	"strings"
	"unicode/utf16"
)

// Normalize preserves unpaired units as barriers while normalizing scalar spans.
func Normalize(value Text) Text {
	out := []uint16{}
	start := 0
	flush := func(end int) {
		if end > start {
			out = append(out, utf16.Encode([]rune(fullLower(scalarNFKC(string(utf16.Decode(value.units[start:end]))))))...)
		}
	}
	for i := 0; i < len(value.units); i++ {
		u := value.units[i]
		if u >= 0xd800 && u <= 0xdbff && i+1 < len(value.units) && value.units[i+1] >= 0xdc00 && value.units[i+1] <= 0xdfff {
			i++
			continue
		}
		if u >= 0xd800 && u <= 0xdfff {
			flush(i)
			out = append(out, u)
			start = i + 1
		}
	}
	flush(len(value.units))
	return NewText(out)
}

// Scalar NFKD avoids stream-safe CGJ insertion across authored scalar boundaries.
func scalarNFKC(s string) string {
	type scalar struct {
		r rune
		c uint8
	}
	d := []scalar{}
	for _, r := range s {
		for _, v := range norm.NFKD.String(string(r)) {
			d = append(d, scalar{v, norm.NFD.PropertiesString(string(v)).CCC()})
		}
	}
	start := 0
	for i, v := range d {
		if v.c == 0 {
			sort.SliceStable(d[start:i], func(a, b int) bool { return d[start+a].c < d[start+b].c })
			start = i + 1
		}
	}
	sort.SliceStable(d[start:], func(a, b int) bool { return d[start+a].c < d[start+b].c })
	out := make([]rune, 0, len(d))
	starter := -1
	var previous uint8
	for _, v := range d {
		if starter >= 0 && (previous == 0 || previous < v.c) {
			pair := []rune(norm.NFC.String(string([]rune{out[starter], v.r})))
			if len(pair) == 1 {
				out[starter] = pair[0]
				continue
			}
		}
		out = append(out, v.r)
		if v.c == 0 {
			starter = len(out) - 1
		}
		previous = v.c
	}
	return string(out)
}
func fullLower(s string) string {
	rr := []rune(s)
	var out strings.Builder
	// Caser owns mutable transformer state and must never be shared between calls.
	lower := cases.Lower(language.Und, cases.HandleFinalSigma(false))
	before := false
	following := make([]bool, len(rr))
	after := false
	for i := len(rr) - 1; i >= 0; i-- {
		following[i] = after
		if !inRanges(rr[i], caseIgnorableRanges) {
			after = inRanges(rr[i], casedRanges)
		}
	}
	for i, r := range rr {
		if r == 'Σ' && before && !following[i] {
			out.WriteRune('ς')
		} else {
			out.WriteString(lower.String(string(r)))
		}
		if !inRanges(r, caseIgnorableRanges) {
			before = inRanges(r, casedRanges)
		}
	}
	return out.String()
}
func inRanges(r rune, ranges [][2]rune) bool {
	i := sort.Search(len(ranges), func(i int) bool { return ranges[i][1] >= r })
	return i < len(ranges) && ranges[i][0] <= r
}
