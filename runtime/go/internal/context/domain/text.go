package domain

import "unicode/utf16"

// Text keeps JavaScript UTF-16 code units, including isolated surrogates.
type Text struct{ units []uint16 }

func NewText(units []uint16) Text { return Text{append([]uint16(nil), units...)} }

// FromString accepts the valid UTF-8 strings supplied by Go callers and adapters.
func FromString(value string) Text { return NewText(utf16.Encode([]rune(value))) }
func (t Text) Units() []uint16     { return append([]uint16(nil), t.units...) }
func (t Text) Len() int            { return len(t.units) }

// String is the replacement UTF-8 output boundary, never an internal conversion.
func (t Text) String() string { return string(utf16.Decode(t.units)) }

func esSpace(c uint16) bool {
	switch c {
	case 9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return c >= 0x2000 && c <= 0x200a
}
func lineTerm(c uint16) bool { return c == 10 || c == 13 || c == 0x2028 || c == 0x2029 }
func (t Text) trimStart() Text {
	i := 0
	for i < t.Len() && esSpace(t.units[i]) {
		i++
	}
	return Text{t.units[i:]}
}
func (t Text) trimEnd() Text {
	i := t.Len()
	for i > 0 && esSpace(t.units[i-1]) {
		i--
	}
	return Text{t.units[:i]}
}
func (t Text) trim() Text { return t.trimStart().trimEnd() }
func (t Text) starts(s string) bool {
	u := FromString(s).units
	if len(u) > t.Len() {
		return false
	}
	for i, c := range u {
		if c != t.units[i] {
			return false
		}
	}
	return true
}
func (t Text) equal(other Text) bool {
	if t.Len() != other.Len() {
		return false
	}
	for i, c := range t.units {
		if c != other.units[i] {
			return false
		}
	}
	return true
}
func (t Text) splitLF() []Text {
	var lines []Text
	start := 0
	for i, c := range t.units {
		if c == 10 {
			lines = append(lines, Text{t.units[start:i]})
			start = i + 1
		}
	}
	return append(lines, Text{t.units[start:]})
}
func joinText(items []Text, separator string) Text {
	var u []uint16
	sep := FromString(separator).units
	for i, item := range items {
		if i > 0 {
			u = append(u, sep...)
		}
		u = append(u, item.units...)
	}
	return Text{u}
}
func concat(items ...Text) Text { return joinText(items, "") }
func (t Text) replaceLF() Text {
	var u []uint16
	for _, c := range t.units {
		u = append(u, c)
		if c == 10 {
			u = append(u, 32, 32)
		}
	}
	return Text{u}
}
func nonEmptyLines(t Text) []Text {
	var result []Text
	for _, line := range t.splitLF() {
		line = line.trim()
		if line.Len() > 0 {
			result = append(result, line)
		}
	}
	return result
}
