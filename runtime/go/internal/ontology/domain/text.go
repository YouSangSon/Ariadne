package ontology

import (
	"slices"
	"unicode/utf16"
)

// Text retains authored ECMAScript UTF-16, including unpaired surrogates.
type Text struct{ units []uint16 }

func NewText(units []uint16) Text     { return Text{append([]uint16(nil), units...)} }
func FromString(value string) Text    { return NewText(utf16.Encode([]rune(value))) }
func (t Text) Units() []uint16        { return append([]uint16(nil), t.units...) }
func (t Text) Len() int               { return len(t.units) }
func (t Text) Equal(other Text) bool  { return slices.Equal(t.units, other.units) }
func (t Text) Compare(other Text) int { return slices.Compare(t.units, other.units) }
func (t Text) Includes(other Text) bool {
	if len(other.units) == 0 {
		return true
	}
	for i := 0; i+len(other.units) <= len(t.units); i++ {
		if slices.Equal(t.units[i:i+len(other.units)], other.units) {
			return true
		}
	}
	return false
}

// Key is an injective binary key, never a UTF-8 serialization.
func (t Text) Key() string {
	b := make([]byte, len(t.units)*2)
	for i, u := range t.units {
		b[2*i] = byte(u >> 8)
		b[2*i+1] = byte(u)
	}
	return string(b)
}

// String follows JS UTF-8 replacement for unpaired units; use Units for identity.
func (t Text) String() string { return string(utf16.Decode(t.units)) }
func (t Text) Trim() Text {
	a, b := 0, len(t.units)
	for a < b && space(t.units[a]) {
		a++
	}
	for b > a && space(t.units[b-1]) {
		b--
	}
	return NewText(t.units[a:b])
}
func space(u uint16) bool {
	return u >= 9 && u <= 13 || u == 32 || u == 0xa0 || u == 0x1680 || u >= 0x2000 && u <= 0x200a || u == 0x2028 || u == 0x2029 || u == 0x202f || u == 0x205f || u == 0x3000 || u == 0xfeff
}
func (t Text) hasControl() bool {
	for _, u := range t.units {
		if u <= 8 || u >= 11 && u <= 31 || u == 127 {
			return true
		}
	}
	return false
}
