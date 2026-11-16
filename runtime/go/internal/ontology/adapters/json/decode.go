// Package ontologyjson preserves the authored JSON contract of Node ontology.
package ontologyjson

import (
	ontology "ariadne/runtime/internal/ontology/domain"
	"bytes"
	"encoding/json"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

type SyntaxError struct{}

func (*SyntaxError) Error() string { return "Invalid ontology JSON" }

type containerState uint8

const (
	arrayStart containerState = iota
	arrayValue
	arrayComma
	objectStart
	objectKey
	objectColon
	objectValue
	objectComma
)

type frame struct {
	state  containerState
	object map[string]any
	array  []any
	key    string
}

// DecodeDocument owns only iterative container grammar. Go1.27 jsonv2 limits even
// Token nesting to 10000; isolated scalar tokens retain stdlib lexical validation.
func DecodeDocument(data []byte) (any, error) {
	stack := []frame{}
	var root any
	haveRoot := false
	position := 0
	attach := func(value any) bool {
		if len(stack) == 0 {
			if haveRoot {
				return false
			}
			root = value
			haveRoot = true
			return true
		}
		f := &stack[len(stack)-1]
		switch f.state {
		case arrayValue:
			f.array = append(f.array, value)
			f.state = arrayComma
		case objectValue:
			f.object[f.key] = value
			f.state = objectComma
		default:
			return false
		}
		return true
	}
	closeContainer := func() bool {
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if f.object != nil {
			return attach(f.object)
		}
		return attach(f.array)
	}
	for {
		for position < len(data) && (data[position] == ' ' || data[position] == '\t' || data[position] == '\n' || data[position] == '\r') {
			position++
		}
		if position == len(data) {
			if haveRoot && len(stack) == 0 {
				return root, nil
			}
			return nil, &SyntaxError{}
		}
		c := data[position]
		if len(stack) == 0 {
			if haveRoot {
				return nil, &SyntaxError{}
			}
		} else {
			f := &stack[len(stack)-1]
			switch f.state {
			case arrayStart:
				if c == ']' {
					if !closeContainer() {
						return nil, &SyntaxError{}
					}
					position++
					continue
				}
				f.state = arrayValue
			case arrayComma:
				if c == ',' {
					f.state = arrayValue
					position++
					continue
				}
				if c == ']' {
					if !closeContainer() {
						return nil, &SyntaxError{}
					}
					position++
					continue
				}
				return nil, &SyntaxError{}
			case objectStart, objectKey:
				if f.state == objectStart && c == '}' {
					if !closeContainer() {
						return nil, &SyntaxError{}
					}
					position++
					continue
				}
				if c != '"' {
					return nil, &SyntaxError{}
				}
				value, used, err := scalar(data[position:])
				if err != nil {
					return nil, err
				}
				key, ok := value.(ontology.Text)
				if !ok {
					return nil, &SyntaxError{}
				}
				f.key = objectKeyString(key)
				f.state = objectColon
				position += used
				continue
			case objectColon:
				if c != ':' {
					return nil, &SyntaxError{}
				}
				f.state = objectValue
				position++
				continue
			case objectComma:
				if c == ',' {
					f.state = objectKey
					position++
					continue
				}
				if c == '}' {
					if !closeContainer() {
						return nil, &SyntaxError{}
					}
					position++
					continue
				}
				return nil, &SyntaxError{}
			}
		}
		switch c {
		case '[':
			stack = append(stack, frame{state: arrayStart, array: []any{}})
			position++
		case '{':
			stack = append(stack, frame{state: objectStart, object: map[string]any{}})
			position++
		default:
			value, used, err := scalar(data[position:])
			if err != nil {
				return nil, err
			}
			if !attach(value) {
				return nil, &SyntaxError{}
			}
			position += used
		}
	}
}
func scalar(data []byte) (any, int, error) {
	// Containers never reach stdlib decoding, so its depth policy cannot classify
	// a valid but wrong-schema ontology as malformed JSON.
	if len(data) == 0 || data[0] == '[' || data[0] == '{' || data[0] == ']' || data[0] == '}' {
		return nil, 0, &SyntaxError{}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil {
		return nil, 0, &SyntaxError{}
	}
	used := int(decoder.InputOffset())
	switch value := token.(type) {
	case string:
		return decodeString(data[:used]), used, nil
	case json.Number:
		number, err := strconv.ParseFloat(string(value), 64)
		if err != nil {
			if e, ok := err.(*strconv.NumError); !ok || e.Err != strconv.ErrRange {
				return nil, 0, &SyntaxError{}
			}
		}
		return number, used, nil
	case bool, nil:
		return value, used, nil
	default:
		return nil, 0, &SyntaxError{}
	}
}
func decodeString(raw []byte) ontology.Text {
	units := []uint16{}
	for i := 1; i < len(raw)-1; {
		if raw[i] == '\\' {
			i++
			switch raw[i] {
			case 'u':
				n, _ := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
				units = append(units, uint16(n))
				i += 5
				continue
			case 'b':
				units = append(units, 8)
			case 'f':
				units = append(units, 12)
			case 'n':
				units = append(units, 10)
			case 'r':
				units = append(units, 13)
			case 't':
				units = append(units, 9)
			default:
				units = append(units, uint16(raw[i]))
			}
			i++
			continue
		}
		r, n := utf8.DecodeRune(raw[i:])
		units = append(units, utf16.Encode([]rune{r})...)
		i += n
	}
	return ontology.NewText(units)
}

// WTF-8 keys retain unpaired units injectively while ordinary field names stay ASCII.
func objectKeyString(text ontology.Text) string {
	units := text.Units()
	out := []byte{}
	for i := 0; i < len(units); i++ {
		u := units[i]
		if u >= 0xd800 && u <= 0xdbff && i+1 < len(units) && units[i+1] >= 0xdc00 && units[i+1] <= 0xdfff {
			out = utf8.AppendRune(out, utf16.DecodeRune(rune(u), rune(units[i+1])))
			i++
		} else if u >= 0xd800 && u <= 0xdfff {
			out = append(out, byte(0xe0|u>>12), byte(0x80|(u>>6)&63), byte(0x80|u&63))
		} else {
			out = utf8.AppendRune(out, rune(u))
		}
	}
	return string(out)
}
