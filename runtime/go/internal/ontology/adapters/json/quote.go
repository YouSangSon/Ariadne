package ontologyjson

import (
	ontology "ariadne/runtime/internal/ontology/domain"
	"unicode/utf16"
	"unicode/utf8"
)

// Quote follows well-formed JSON.stringify without HTML or line-separator escaping.
func Quote(value ontology.Text) []byte {
	out := []byte{'"'}
	units := value.Units()
	const hex = "0123456789abcdef"
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch u {
		case '"', '\\':
			out = append(out, '\\', byte(u))
		case 8:
			out = append(out, '\\', 'b')
		case 9:
			out = append(out, '\\', 't')
		case 10:
			out = append(out, '\\', 'n')
		case 12:
			out = append(out, '\\', 'f')
		case 13:
			out = append(out, '\\', 'r')
		default:
			if u >= 0xd800 && u <= 0xdbff && i+1 < len(units) && units[i+1] >= 0xdc00 && units[i+1] <= 0xdfff {
				out = utf8.AppendRune(out, utf16.DecodeRune(rune(u), rune(units[i+1])))
				i++
			} else if u < 32 || u >= 0xd800 && u <= 0xdfff {
				out = append(out, '\\', 'u', hex[u>>12], hex[(u>>8)&15], hex[(u>>4)&15], hex[u&15])
			} else {
				out = utf8.AppendRune(out, rune(u))
			}
		}
	}
	return append(out, '"')
}
