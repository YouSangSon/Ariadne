package verification

import "unicode/utf16"

// Text preserves JavaScript string code units, including unpaired surrogates.
type Text struct{ units []uint16 }

func NewText(units []uint16) Text { return Text{append([]uint16{}, units...)} }
func TextOf(s string) Text        { return NewText(utf16.Encode([]rune(s))) }
func (t Text) Units() []uint16    { return append([]uint16{}, t.units...) }
func (t Text) IsEmpty() bool      { return len(t.units) == 0 }

// String is for display and replaces unpaired surrogates.
func (t Text) String() string { return string(utf16.Decode(t.units)) }

func hasASCIIPrefix(units []uint16, prefix string) bool {
	if len(units) < len(prefix) {
		return false
	}
	for i := range len(prefix) {
		if units[i] != uint16(prefix[i]) {
			return false
		}
	}
	return true
}

func jsLineTerminator(unit uint16) bool {
	switch unit {
	case '\r', '\n', 0x2028, 0x2029:
		return true
	}
	return false
}

func jsWhitespace(unit uint16) bool {
	switch unit {
	case '\t', '\v', '\f', ' ', 0x00a0, 0x1680, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return jsLineTerminator(unit) || unit >= 0x2000 && unit <= 0x200a
}
