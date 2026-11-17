package contextjson

import (
	contextapp "ariadne/runtime/internal/context/application"
	"ariadne/runtime/internal/context/domain"
	"bytes"
	"encoding/json"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

// quote preserves JSON.stringify's lone-surrogate and literal HTML/separator output.
func quote(value domain.Text) []byte {
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
				out = append(out, '\\', 'u', hex[u>>12], hex[u>>8&15], hex[u>>4&15], hex[u&15])
			} else {
				out = utf8.AppendRune(out, rune(u))
			}
		}
	}
	return append(out, '"')
}
func EncodeCatalog(c contextapp.Catalog) ([]byte, error) {
	out := []byte(`{"schema_version":` + strconv.Itoa(c.SchemaVersion) + `,"trust":`)
	out = append(out, quote(domain.FromString(c.Trust))...)
	out = append(out, `,"skills":[`...)
	for i, s := range c.Skills {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, `{"name":`...)
		out = append(out, quote(domain.FromString(s.Name))...)
		out = append(out, `,"description":`...)
		out = append(out, quote(s.Description)...)
		out = append(out, `,"path":`...)
		out = append(out, quote(domain.FromString(s.Path))...)
		out = append(out, `,"sha256":`...)
		out = append(out, quote(domain.FromString(s.SHA256))...)
		out = append(out, `,"chars":`...)
		out = append(out, strconv.Itoa(s.Chars)...)
		out = append(out, `,"selection":`...)
		out = append(out, quote(domain.FromString(s.Selection))...)
		out = append(out, '}')
	}
	out = append(out, ']', '}')
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, out, "", "  "); err != nil {
		return nil, err
	}
	return append(pretty.Bytes(), '\n'), nil
}
