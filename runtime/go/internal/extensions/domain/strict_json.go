package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"
)

// DecodeStrictJSON rejects ambiguity before decoding into an exact, required-field DTO.
func DecodeStrictJSON(data []byte, maxBytes int, target any) error {
	if len(data) > maxBytes {
		return errors.New("JSON byte limit exceeded")
	}
	if !utf8.Valid(data) || !validSurrogateEscapes(data) {
		return errors.New("invalid UTF-8 or Unicode escape")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	value, err := readJSONValue(decoder, 0)
	if err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("expected exactly one JSON value")
	}
	typ := reflect.TypeOf(target)
	if typ == nil || typ.Kind() != reflect.Pointer {
		return errors.New("JSON target must be a pointer")
	}
	if err := checkJSONShape(value, typ.Elem()); err != nil {
		return err
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return errors.New("invalid JSON value")
	}
	return json.Unmarshal(canonical, target)
}

func readJSONValue(decoder *json.Decoder, depth int) (any, error) {
	if depth > 16 {
		return nil, errors.New("JSON nesting limit exceeded")
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, errors.New("invalid JSON")
	}
	if token == nil {
		return nil, errors.New("explicit null is not allowed")
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			object := map[string]any{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return nil, errors.New("invalid object key")
				}
				name, ok := key.(string)
				if !ok {
					return nil, errors.New("invalid object key")
				}
				if _, exists := object[name]; exists {
					return nil, errors.New("duplicate JSON key")
				}
				item, err := readJSONValue(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				object[name] = item
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return nil, errors.New("invalid object")
			}
			return object, nil
		case '[':
			items := []any{}
			for decoder.More() {
				item, err := readJSONValue(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				items = append(items, item)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return nil, errors.New("invalid array")
			}
			return items, nil
		}
		return nil, errors.New("unexpected JSON delimiter")
	case string:
		if len(value) > MaxStringBytes {
			return nil, errors.New("string byte limit exceeded")
		}
	}
	return token, nil
}

func checkJSONShape(value any, typ reflect.Type) error {
	if typ.Kind() == reflect.Pointer {
		return checkJSONShape(value, typ.Elem())
	}
	switch typ.Kind() {
	case reflect.Struct:
		object, ok := value.(map[string]any)
		if !ok {
			return errors.New("expected JSON object")
		}
		fields := map[string]reflect.StructField{}
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
			fields[name] = field
		}
		for name, item := range object {
			field, ok := fields[name]
			if !ok {
				return errors.New("unknown JSON field")
			}
			if err := checkJSONShape(item, field.Type); err != nil {
				return err
			}
			fieldType := field.Type
			if fieldType.Kind() == reflect.Pointer {
				fieldType = fieldType.Elem()
			}
			if fieldType.Kind() == reflect.Int || fieldType.Kind() == reflect.Int64 {
				integer, err := boundedInteger(item.(json.Number).String())
				if err != nil {
					return err
				}
				object[name] = json.Number(integer)
			}
		}
		for name, field := range fields {
			if _, exists := object[name]; !exists && !strings.Contains(field.Tag.Get("json"), ",omitempty") {
				return fmt.Errorf("required field missing: %s", name)
			}
		}
	case reflect.Slice:
		array, ok := value.([]any)
		if !ok {
			return errors.New("expected JSON array")
		}
		for _, item := range array {
			if err := checkJSONShape(item, typ.Elem()); err != nil {
				return err
			}
		}
	case reflect.String:
		if _, ok := value.(string); !ok {
			return errors.New("expected JSON string")
		}
	case reflect.Int, reflect.Int64:
		if _, ok := value.(json.Number); !ok {
			return errors.New("expected JSON number")
		}
	case reflect.Float64:
		number, ok := value.(json.Number)
		if !ok {
			return errors.New("expected JSON number")
		}
		parsed, err := number.Float64()
		if err != nil {
			return errors.New("JSON number exceeds float64 limits")
		}
		mantissa, _, _ := strings.Cut(strings.ToLower(number.String()), "e")
		if parsed == 0 && strings.Trim(mantissa, "-+.0") != "" {
			return errors.New("nonzero JSON number underflows float64")
		}

	default:
		return errors.New("unsupported JSON contract type")
	}
	return nil
}

// encoding/json otherwise replaces unpaired surrogate escapes with U+FFFD.
func validSurrogateEscapes(data []byte) bool {
	inString := false
	for i := 0; i < len(data); i++ {
		if data[i] == '"' {
			inString = !inString
			continue
		}
		if !inString || data[i] != '\\' {
			continue
		}
		i++
		if i >= len(data) {
			return false
		}
		if data[i] != 'u' {
			continue
		}
		if i+4 >= len(data) {
			return false
		}
		code, err := strconv.ParseUint(string(data[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if code >= 0xDC00 && code <= 0xDFFF {
			return false
		}
		if code < 0xD800 || code > 0xDBFF {
			continue
		}
		if i+6 >= len(data) || data[i+1] != '\\' || data[i+2] != 'u' {
			return false
		}
		low, err := strconv.ParseUint(string(data[i+3:i+7]), 16, 16)
		if err != nil || low < 0xDC00 || low > 0xDFFF {
			return false
		}
		i += 6
	}
	return true
}

// Normalize JSON Schema integers exactly, without large-exponent arithmetic.
func boundedInteger(number string) (string, error) {
	invalid := errors.New("expected bounded JSON integer")
	negative := strings.HasPrefix(number, "-")
	digits := strings.TrimPrefix(number, "-")
	exponentText := "0"
	if index := strings.IndexAny(digits, "eE"); index >= 0 {
		exponentText = digits[index+1:]
		digits = digits[:index]
	}
	fraction := 0
	if index := strings.IndexByte(digits, '.'); index >= 0 {
		fraction = len(digits) - index - 1
		digits = digits[:index] + digits[index+1:]
	}
	digits = strings.TrimLeft(digits, "0")
	if digits == "" {
		return "0", nil
	}
	exponent, err := strconv.ParseInt(exponentText, 10, 64)
	if err != nil || exponent > int64(fraction)+19 || exponent < int64(fraction)-int64(len(digits)) {
		return "", invalid
	}
	shift := exponent - int64(fraction)
	if shift < 0 {
		tail := digits[len(digits)+int(shift):]
		if strings.Trim(tail, "0") != "" {
			return "", invalid
		}
		digits = digits[:len(digits)+int(shift)]
	} else {
		if int64(len(digits))+shift > 19 {
			return "", invalid
		}
		digits += strings.Repeat("0", int(shift))
	}
	if negative {
		digits = "-" + digits
	}
	value, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return "", invalid
	}
	return strconv.FormatInt(value, 10), nil
}
