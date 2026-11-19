package domain

import (
	"slices"
	"unicode/utf16"
)

// Text owns immutable ECMAScript UTF16 units, including unpaired surrogates.
type Text struct{ units []uint16 }

func NewText(units []uint16) Text { return Text{append([]uint16(nil), units...)} }

// FromString accepts valid UTF8 from Go callers; Units is the lossless boundary.
func FromString(value string) Text { return NewText(utf16.Encode([]rune(value))) }
func (t Text) Units() []uint16     { return append([]uint16(nil), t.units...) }

// String replaces unpaired surrogates for UTF8 display, never for internal identity.
func (t Text) String() string { return string(utf16.Decode(t.units)) }
func space(u uint16) bool {
	return u >= 9 && u <= 13 || u == 32 || u == 0xa0 || u == 0x1680 || u >= 0x2000 && u <= 0x200a || u == 0x2028 || u == 0x2029 || u == 0x202f || u == 0x205f || u == 0x3000 || u == 0xfeff
}
func lineTerm(u uint16) bool { return u == 10 || u == 13 || u == 0x2028 || u == 0x2029 }
func (t Text) indent() int {
	for i, u := range t.units {
		if !space(u) {
			return i
		}
	}
	return len(t.units)
}
func (t Text) trimStart() Text { return Text{t.units[t.indent():]} }
func (t Text) trimEnd() Text {
	i := len(t.units)
	for i > 0 && space(t.units[i-1]) {
		i--
	}
	return Text{t.units[:i]}
}
func (t Text) trim() Text { return t.trimStart().trimEnd() }
func (t Text) starts(s string) bool {
	u := FromString(s).units
	return len(t.units) >= len(u) && slices.Equal(t.units[:len(u)], u)
}
func (t Text) equal(s string) bool { return slices.Equal(t.units, FromString(s).units) }
func (t Text) splitLF() []Text {
	lines := []Text{}
	start := 0
	for i, u := range t.units {
		if u == 10 {
			lines = append(lines, Text{t.units[start:i]})
			start = i + 1
		}
	}
	return append(lines, Text{t.units[start:]})
}
func join(lines []Text, separator uint16) Text {
	var u []uint16
	for i, line := range lines {
		if i > 0 {
			u = append(u, separator)
		}
		u = append(u, line.units...)
	}
	return Text{u}
}
func noLineTerms(t Text) bool {
	for _, u := range t.units {
		if lineTerm(u) {
			return false
		}
	}
	return true
}
func comment(t Text) bool { return t.trimStart().starts("#") }

// commentTail matches the optional whitespace-plus-comment suffix used by canonical scalars.
func commentTail(t Text) bool {
	if len(t.units) == 0 {
		return true
	}
	n := t.indent()
	return n > 0 && n < len(t.units) && t.units[n] == '#' && noLineTerms(Text{t.units[n:]})
}
func letter(u uint16) bool { return u >= 'a' && u <= 'z' || u == '_' }
func digit(u uint16) bool  { return u >= '0' && u <= '9' }
func mapping(t Text) (string, Text, bool) {
	if len(t.units) == 0 || !letter(t.units[0]) {
		return "", Text{}, false
	}
	i := 1
	for i < len(t.units) && (letter(t.units[i]) || digit(t.units[i])) {
		i++
	}
	if i == len(t.units) || t.units[i] != ':' {
		return "", Text{}, false
	}
	return Text{t.units[:i]}.String(), Text{t.units[i+1:]}, true
}
