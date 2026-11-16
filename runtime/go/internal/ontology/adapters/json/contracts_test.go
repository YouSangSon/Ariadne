package ontologyjson_test

import (
	codec "ariadne/runtime/internal/ontology/adapters/json"
	app "ariadne/runtime/internal/ontology/application"
	ontology "ariadne/runtime/internal/ontology/domain"
	"crypto/sha256"
	"encoding/hex"
	stdjson "encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

const root = "../../../../../../"

func decode(t *testing.T, data []byte) any {
	t.Helper()
	v, e := codec.DecodeDocument(data)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func file(t *testing.T, path string) []byte {
	t.Helper()
	v, e := os.ReadFile(root + path)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func text(v any) string { return v.(ontology.Text).String() }
func errorValue(err error) map[string]any {
	name := "Error"
	var syntax *codec.SyntaxError
	if errors.As(err, &syntax) {
		name = "SyntaxError"
	}
	v := map[string]any{"name": ontology.FromString(name)}
	if name != "SyntaxError" {
		v["message"] = ontology.FromString(err.Error())
	}
	return v
}
func valueOrError(v any, err error) map[string]any {
	if err != nil {
		return map[string]any{"error": errorValue(err)}
	}
	return map[string]any{"value": canonical(reflect.ValueOf(v))}
}

// Test-only projection compares typed fields against independently authored literals.
func canonical(v reflect.Value) any {
	if !v.IsValid() {
		return nil
	}
	if v.Kind() == reflect.Interface || v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return nil
		}
		return canonical(v.Elem())
	}
	if v.Type() == reflect.TypeFor[ontology.Text]() {
		return v.Interface()
	}
	switch v.Kind() {
	case reflect.Struct:
		out := map[string]any{}
		for i := 0; i < v.NumField(); i++ {
			f := v.Type().Field(i)
			tag := f.Tag.Get("json")
			if f.Anonymous {
				for k, value := range canonical(v.Field(i)).(map[string]any) {
					out[k] = value
				}
				continue
			}
			if strings.Contains(tag, "omitempty") && v.Field(i).IsZero() {
				continue
			}
			key := strings.Split(tag, ",")[0]
			if key == "" {
				key = f.Name
			}
			out[key] = canonical(v.Field(i))
		}
		return out
	case reflect.Slice:
		out := []any{}
		for i := 0; i < v.Len(); i++ {
			out = append(out, canonical(v.Index(i)))
		}
		return out
	case reflect.Map:
		out := map[string]any{}
		iter := v.MapRange()
		for iter.Next() {
			out[iter.Key().String()] = canonical(iter.Value())
		}
		return out
	case reflect.String:
		return ontology.FromString(v.String())
	case reflect.Int, reflect.Int64:
		return float64(v.Int())
	default:
		return v.Interface()
	}
}
func TestNodeGoldens(t *testing.T) {
	inputs := decode(t, file(t, "contracts/ontology/node-v1/cases.json")).(map[string]any)["cases"].([]any)
	expected := decode(t, file(t, "contracts/ontology/node-v1/expected.json")).(map[string]any)["cases"].([]any)
	if len(inputs) != 36 || len(expected) != 36 {
		t.Fatal("36 literal Node cases required")
	}
	for i, input := range inputs {
		entry := input.(map[string]any)
		t.Run(text(entry["id"]), func(t *testing.T) {
			document := []byte(text(entry["document_json"]))
			observed := map[string]any{"id": entry["id"], "document_reads": float64(0), "source_reads": []any{}, "fingerprints": []any{}}
			parsed, err := codec.DecodeDocument(document)
			var definition ontology.Definition
			if err == nil {
				definition, err = ontology.ValidateDefinition(parsed)
			}
			observed["validation"] = valueOrError(definition, err)
			snapshot, err := app.LoadOntology(app.Ports{ReadDocument: func() (any, error) {
				observed["document_reads"] = observed["document_reads"].(float64) + 1
				return codec.DecodeDocument(document)
			}, ReadSource: func(path ontology.Text) (string, error) {
				observed["source_reads"] = append(observed["source_reads"].([]any), path)
				source, ok := entry["sources"].(map[string]any)[path.String()]
				if !ok {
					return "", fmt.Errorf("missing source")
				}
				sum := sha256.Sum256([]byte(text(source)))
				return hex.EncodeToString(sum[:]), nil
			}, Fingerprint: func(payload app.FingerprintPayload) string {
				bytes := codec.FingerprintBytes(payload)
				sum := sha256.Sum256(bytes)
				hash := hex.EncodeToString(sum[:])
				if codec.Fingerprint(payload) != hash {
					t.Fatal("digest differs from observed bytes")
				}
				observed["fingerprints"] = append(observed["fingerprints"].([]any), map[string]any{"utf8_hex": ontology.FromString(hex.EncodeToString(bytes)), "sha256": ontology.FromString(hash)})
				return hash
			}})
			if err != nil {
				observed["load_error"] = errorValue(err)
			} else {
				observed["inspect"] = canonical(reflect.ValueOf(app.InspectOntology(snapshot)))
				searches := []any{}
				for _, raw := range entry["searches"].([]any) {
					query := raw.(map[string]any)
					limit, present := query["limit"]
					value, err := app.SearchOntology(snapshot, query["query"], ontology.Limit{Present: present, Value: limit})
					searches = append(searches, valueOrError(value, err))
				}
				observed["searches"] = searches
			}
			if !reflect.DeepEqual(observed, expected[i]) {
				t.Fatalf("Node literal mismatch\ngot: %#v\nwant: %#v", observed, expected[i])
			}
		})
	}
}
func TestRawUTF16AndQuote(t *testing.T) {
	values := []struct {
		raw    string
		units  []uint16
		quoted string
	}{
		{`"\ud800"`, []uint16{0xd800}, `"\ud800"`}, {`"\udfff"`, []uint16{0xdfff}, `"\udfff"`}, {`"😀"`, []uint16{0xd83d, 0xde00}, `"😀"`}, {`"\ud83d\ude00"`, []uint16{0xd83d, 0xde00}, `"😀"`}, {`"<>&\u2028\u2029"`, []uint16{'<', '>', '&', 0x2028, 0x2029}, "\"<>&\u2028\u2029\""}, {`"\n\t\b\f\r\u0000\"\\"`, []uint16{10, 9, 8, 12, 13, 0, '"', '\\'}, `"\n\t\b\f\r\u0000\"\\"`},
	}
	for _, v := range values {
		parsed := decode(t, []byte(v.raw)).(ontology.Text)
		if !reflect.DeepEqual(parsed.Units(), v.units) {
			t.Fatalf("units %x want %x", parsed.Units(), v.units)
		}
		if got := string(codec.Quote(ontology.NewText(v.units))); got != v.quoted {
			t.Fatalf("quote %q want %q", got, v.quoted)
		}
	}
}
func TestJSONGrammarDepthNumbersAndKeys(t *testing.T) {
	for _, bad := range []string{"", " ", "[", "{", `{"a":}`, `{"a" 1}`, `[1,]`, `{"a":1,}`, `true false`, `[] []`, `01`, `1e`, `"\x"`, `"\u12xx"`, "[}", "]", `{"x":[1}`} {
		if _, err := codec.DecodeDocument([]byte(bad)); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	for _, n := range []int{10001, 50000} {
		for _, kind := range []string{"array", "object"} {
			prefix, suffix := "[", "]"
			if kind == "object" {
				prefix, suffix = `{"x":`, "}"
			}
			raw := `{"schema_version":1,"terms":` + strings.Repeat(prefix, n) + "0" + strings.Repeat(suffix, n) + `}`
			v, err := codec.DecodeDocument([]byte(raw))
			if err != nil {
				t.Fatal(n, kind, err)
			}
			_, err = ontology.ValidateDefinition(v)
			if err == nil || err.Error() != "Expected fields: schema_version, terms, relations; optional: reviewed_digest" {
				t.Fatal(n, err)
			}
			if _, err = codec.DecodeDocument([]byte(raw[:len(raw)-1])); err == nil {
				t.Fatal("accepted unclosed deep document")
			}
		}
	}
	for _, version := range []string{"1e0", "1.000", "1.0000000000000001"} {
		_, err := ontology.ValidateDefinition(decode(t, []byte(`{"schema_version":`+version+`,"terms":[],"relations":[]}`)))
		if err != nil {
			t.Fatal(version, err)
		}
	}
	for _, number := range []string{"1e400", "-1e400", "1e-4000"} {
		v := decode(t, []byte(`{"schema_version":`+number+`,"terms":[],"relations":[]}`))
		_, err := ontology.ValidateDefinition(v)
		if err == nil || err.Error() != "Unsupported ontology schema_version" {
			t.Fatal(number, err)
		}
	}
	object := decode(t, []byte(`{"x":1,"x":2,"X":3,"\ud800":4,"\udfff":5,"�":6}`)).(map[string]any)
	if len(object) != 5 || object["x"] != float64(2) || object["X"] != float64(3) {
		t.Fatal(object)
	}
}
func TestPortFailuresAndOrdering(t *testing.T) {
	failure := errors.New("controlled port failure")
	reads, hashes := 0, 0
	ports := app.Ports{ReadDocument: func() (any, error) { return nil, failure }, ReadSource: func(ontology.Text) (string, error) { reads++; return "", failure }, Fingerprint: func(app.FingerprintPayload) string { hashes++; return "digest" }}
	if _, err := app.LoadOntology(ports); !errors.Is(err, failure) || reads != 0 || hashes != 0 {
		t.Fatal(err, reads, hashes)
	}
	ports.ReadDocument = func() (any, error) {
		return codec.DecodeDocument([]byte(`{"schema_version":1,"terms":[{"id":"a","name":"a","description":"a","synonyms":[],"sources":["a.md"]}],"relations":[]}`))
	}
	if _, err := app.LoadOntology(ports); !errors.Is(err, failure) || reads != 1 || hashes != 0 {
		t.Fatal(err, reads, hashes)
	}
}

func BenchmarkBoundedOntologyLoadAndSearch(b *testing.B) {
	var document strings.Builder
	document.WriteString(`{"schema_version":1,"terms":[`)
	for i := 0; i < 1000; i++ {
		if i > 0 {
			document.WriteByte(',')
		}
		fmt.Fprintf(&document, `{"id":"term-%04d","name":"%s","description":"%s","synonyms":[],"sources":[]}`, i, strings.Repeat("A", 200), strings.Repeat("x", 700))
	}
	document.WriteString(`],"relations":[]}`)
	raw := []byte(document.String())
	if len(raw) > 1<<20 {
		b.Fatal("benchmark exceeds existing file limit")
	}
	b.SetBytes(int64(len(raw)))
	for b.Loop() {
		snapshot, err := app.LoadOntology(app.Ports{ReadDocument: func() (any, error) { return codec.DecodeDocument(raw) }, ReadSource: func(ontology.Text) (string, error) { b.Fatal("unexpected source read"); return "", nil }, Fingerprint: codec.Fingerprint})
		if err != nil {
			b.Fatal(err)
		}
		if _, err = app.SearchOntology(snapshot, ontology.FromString(strings.Repeat("x", 256)), ontology.Limit{}); err != nil {
			b.Fatal(err)
		}
	}
}

func FuzzDecodeSyntax(f *testing.F) {
	for _, seed := range []string{`null`, `true`, `1e400`, `-0`, `"\ud800"`, `{"a":1,"a":2}`, `[{},[null,true,2.0],"x"]`, `{"a" 1}`, `{"a":}`, `[1,]`, `[`, `{`, `1e`, `01`, `truefalse`, `"\u12xx"`, `[] []`, `{"a":{"b":[]}}`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 4096 || !utf8.Valid(data) {
			return
		}
		_, err := codec.DecodeDocument(data)
		if (err == nil) != stdjson.Valid(data) {
			t.Fatalf("syntax differs from independent stdlib validator for %q: %v", data, err)
		}
	})
}

func TestEveryUTF16UnitRoundTrips(t *testing.T) {
	units := make([]uint16, 65536)
	for i := range units {
		units[i] = uint16(i)
	}
	decoded, err := codec.DecodeDocument(codec.Quote(ontology.NewText(units)))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded.(ontology.Text).Units(), units) {
		t.Fatal("all-unit roundtrip changed authored UTF-16")
	}
}
func TestValidationErrorOrder(t *testing.T) {
	for _, v := range []struct{ document, want string }{
		{`{"schema_version":1,"terms":[{"id":"x","name":null,"description":null,"synonyms":null,"sources":null}],"relations":[]}`, "Invalid synonyms; maximum 10"},
		{`{"schema_version":1,"terms":[{"id":"x","name":null,"description":null,"synonyms":["Ａ","a"],"sources":null}],"relations":[]}`, "Duplicate synonym: x"},
		{`{"schema_version":1,"terms":[{"id":"x","name":null,"description":null,"synonyms":[],"sources":null}],"relations":[]}`, "Invalid name"},
		{`{"schema_version":1,"terms":[{"id":"x","name":"x","description":null,"synonyms":[],"sources":null}],"relations":[]}`, "Invalid description"},
		{`{"schema_version":1,"terms":[{"id":"x","name":"x","description":"x","synonyms":[],"sources":["a","a",null]}],"relations":[]}`, "Invalid source path"},
		{`{"schema_version":1,"terms":[],"relations":[{"from":"x","type":"x","to":"x","sources":null}]}`, "Relation refers to an unknown term"},
	} {
		_, err := ontology.ValidateDefinition(decode(t, []byte(v.document)))
		if err == nil || err.Error() != v.want {
			t.Fatal(err, v.want)
		}
	}
	definition := ontology.Definition{SchemaVersion: 1, Terms: []ontology.Term{}, Relations: []ontology.Relation{}}
	if _, err := ontology.SearchTerms(definition, nil, ontology.Limit{Present: true, Value: nil}); err == nil || err.Error() != "Invalid query" {
		t.Fatal(err)
	}
}

func TestDeepShadowedValuesStillRequireCompleteSyntax(t *testing.T) {
	const emptyDigest = "53bcda5fb0b16a5d93d4c9f4949d95176625e22cc18e1ac708a149ac397e7752"
	const emptyBytes = "7b2266696e6765727072696e745f76657273696f6e223a312c22646566696e6974696f6e223a7b22736368656d615f76657273696f6e223a312c227465726d73223a5b5d2c2272656c6174696f6e73223a5b5d7d2c22736f757263655f686173686573223a5b5d7d"
	for _, depth := range []int{10001, 50000} {
		for _, kind := range []string{"array", "object", "mixed"} {
			for _, field := range []string{"terms", "schema_version"} {
				for _, mutation := range []string{"valid", "string_valid", "mismatched", "comma", "colon", "missing_close", "incomplete_escape"} {
					opening, closing := make([]string, depth), make([]string, depth)
					for i := range depth {
						if kind == "array" || kind == "mixed" && i%2 == 0 {
							opening[i], closing[depth-1-i] = "[", "]"
						} else {
							opening[i], closing[depth-1-i] = `{"x":`, "}"
						}
					}
					inner := "0"
					switch mutation {
					case "string_valid":
						inner = `"quote\" backslash\\ \ud800"`
					case "comma":
						inner = "[0,]"
					case "colon":
						inner = `{"x"0}`
					case "mismatched":
						if closing[0] == "]" {
							closing[0] = "}"
						} else {
							closing[0] = "]"
						}
					case "missing_close":
						closing = closing[1:]
					case "incomplete_escape":
						inner = "\"unfinished\\"
					}
					document := []byte(`{"` + field + `":` + strings.Join(opening, "") + inner + strings.Join(closing, "") + `,"schema_version":1,"\u0074erms":[],"relations":[]}`)
					if len(document) > 1<<20 {
						t.Fatal("witness exceeds existing file limit")
					}
					reads, sources, hashes := 0, 0, 0
					snapshot, err := app.LoadOntology(app.Ports{ReadDocument: func() (any, error) { reads++; return codec.DecodeDocument(document) }, ReadSource: func(ontology.Text) (string, error) { sources++; return "", errors.New("unexpected source read") }, Fingerprint: func(payload app.FingerprintPayload) string {
						hashes++
						if got := hex.EncodeToString(codec.FingerprintBytes(payload)); got != emptyBytes {
							t.Fatalf("shadowed input changed literal Node bytes %s", got)
						}
						return codec.Fingerprint(payload)
					}})
					valid := mutation == "valid" || mutation == "string_valid"
					if reads != 1 || sources != 0 {
						t.Fatal(depth, kind, field, mutation, reads, sources)
					}
					if valid {
						if err != nil || hashes != 1 || snapshot.Digest != emptyDigest || snapshot.ReviewStatus != "unreviewed" || len(snapshot.Definition.Terms) != 0 || len(snapshot.Definition.Relations) != 0 {
							t.Fatal(depth, kind, field, mutation, err, hashes, snapshot.Digest)
						}
					} else {
						var syntax *codec.SyntaxError
						if !errors.As(err, &syntax) || hashes != 0 {
							t.Fatal(depth, kind, field, mutation, "malformed shadowed input must stay SyntaxError", err, hashes)
						}
					}
				}
			}
		}
	}
}
func TestJSONWhitespaceAndCompleteRoot(t *testing.T) {
	for _, raw := range []string{"\u00a0null", "null\u00a0", "\ufeffnull", "null\ufeff", `[1 2]`, `{"a",1}`, `{"a"::1}`, `{"a":1 "b":2}`, `[,1]`, `[1,,2]`, `{,"a":1}`, `{"a":1,,"b":2}`, `[true false]`, `null:null`, `null,`, `null true`, `[0]null`, `"unterminated\`} {
		if _, err := codec.DecodeDocument([]byte(raw)); err == nil {
			t.Fatalf("accepted malformed syntax %q", raw)
		}
	}
	for _, raw := range []string{" \t\r\nnull\r\n\t ", `{"a":0,"a":[]}`, `[1e400,-1e400,1e-4000,-0]`, `["\ud800","\udfff","\"","\\"]`} {
		if _, err := codec.DecodeDocument([]byte(raw)); err != nil {
			t.Fatal(raw, err)
		}
	}
}
