package domain

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type nodeError struct{ Message string }
type criterionHex struct{ ID, Statement, Verification string }
type contractHex struct {
	ReqID    string `json:"req_id"`
	Status   string
	Criteria []criterionHex
	Scope    []string
}
type domainExpected struct {
	ID    string
	Parse struct {
		UTF16 contractHex `json:"utf16_hex"`
		Error *nodeError
	}
	Result struct {
		UTF16 json.RawMessage `json:"utf16_hex"`
		Count int
		SHA   string `json:"utf16be_nul_sha256"`
		Error *nodeError
	}
	Error *nodeError
}
type domainInput struct {
	ID, Op string
	ReqID  *string `json:"req_id"`
	YAML   json.RawMessage
	Paths  []json.RawMessage
	Recipe *struct {
		Count, Width, Duplicates, Excluded int
		Prefix                             string
	} `json:"path_recipe"`
}

// This fixture-only decoder reads authored JSON escapes independently of the production scalar parser.
func fixtureText(t *testing.T, raw json.RawMessage) Text {
	t.Helper()
	var units []uint16
	for i := 1; i < len(raw)-1; i++ {
		c := raw[i]
		if c != '\\' {
			units = append(units, uint16(c))
			continue
		}
		i++
		if raw[i] == 'u' {
			n, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
			if err != nil {
				t.Fatal(err)
			}
			units = append(units, uint16(n))
			i += 4
			continue
		}
		value, err := strconv.Unquote("\"" + string(raw[i-1:i+1]) + "\"")
		if err != nil {
			t.Fatal(err)
		}
		units = append(units, uint16(value[0]))
	}
	return NewText(units)
}
func unitsHex(text Text) string {
	b := make([]byte, len(text.units)*2)
	for i, u := range text.units {
		binary.BigEndian.PutUint16(b[2*i:], u)
	}
	return hex.EncodeToString(b)
}
func loadDomainFixtures(t *testing.T) ([]domainInput, map[string]domainExpected) {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile("../../../../../contracts/requirements/node-v1/" + name)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	var inputs struct{ Cases []domainInput }
	var expected struct{ Cases []domainExpected }
	if err := json.Unmarshal(read("cases.json"), &inputs); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(read("expected.json"), &expected); err != nil {
		t.Fatal(err)
	}
	byID := map[string]domainExpected{}
	for _, e := range expected.Cases {
		byID[e.ID] = e
	}
	return inputs.Cases, byID
}
func assertDomainError(t *testing.T, err error, want *nodeError) bool {
	t.Helper()
	if want != nil {
		if err == nil || err.Error() != want.Message {
			t.Fatalf("error=%v want %q", err, want.Message)
		}
		return true
	}
	if err != nil {
		t.Fatal(err)
	}
	return false
}
func TestParseContractNodeOracle(t *testing.T) {
	inputs, expected := loadDomainFixtures(t)
	for _, input := range inputs {
		if input.Op != "contract" {
			continue
		}
		t.Run(input.ID, func(t *testing.T) {
			yaml := fixtureText(t, input.YAML)
			before := yaml.Units()
			got, err := ParseContract(yaml, *input.ReqID)
			if !reflect.DeepEqual(yaml.Units(), before) {
				t.Fatal("parser changed input")
			}
			want := expected[input.ID].Parse
			if assertDomainError(t, err, want.Error) {
				return
			}
			actual := contractHex{ReqID: unitsHex(FromString(got.ReqID)), Status: unitsHex(FromString(got.Status)), Criteria: []criterionHex{}, Scope: []string{}}
			for _, c := range got.Criteria {
				actual.Criteria = append(actual.Criteria, criterionHex{unitsHex(c.ID), unitsHex(c.Statement), unitsHex(c.Verification)})
			}
			for _, s := range got.Scope {
				actual.Scope = append(actual.Scope, unitsHex(s))
			}
			if !reflect.DeepEqual(actual, want.UTF16) {
				t.Fatalf("contract=%#v want %#v", actual, want.UTF16)
			}
		})
	}
}
func TestSlugNodeOracle(t *testing.T) {
	inputs, expected := loadDomainFixtures(t)
	for _, input := range inputs {
		if input.Op != "slug" {
			continue
		}
		t.Run(input.ID, func(t *testing.T) {
			value, err := Slug(*input.ReqID)
			want := expected[input.ID].Result
			if assertDomainError(t, err, want.Error) {
				return
			}
			var text string
			if err := json.Unmarshal(want.UTF16, &text); err != nil {
				t.Fatal(err)
			}
			if unitsHex(FromString(value)) != text {
				t.Fatalf("slug=%q", value)
			}
		})
	}
}
func TestSourceFilesNodeOracle(t *testing.T) {
	inputs, expected := loadDomainFixtures(t)
	for _, input := range inputs {
		if input.Op != "files" {
			continue
		}
		t.Run(input.ID, func(t *testing.T) {
			paths := []Text{}
			for _, p := range input.Paths {
				paths = append(paths, fixtureText(t, p))
			}
			if r := input.Recipe; r != nil {
				prefix, width := r.Prefix, r.Width
				if prefix == "" {
					prefix = "file-"
				}
				if width == 0 {
					width = 5
				}
				for i := 0; i < r.Count; i++ {
					paths = append(paths, FromString(prefix+fmt.Sprintf("%0*d", width, i)))
				}
				for i := 0; i < r.Duplicates; i++ {
					paths = append(paths, paths[i%r.Count])
				}
				for i := 0; i < r.Excluded; i++ {
					paths = append(paths, FromString(fmt.Sprint("node_modules/generated-", i)))
				}
			}
			before := append([]Text{}, paths...)
			got, err := SourceFiles(paths, input.ReqID)
			want := expected[input.ID]
			if !reflect.DeepEqual(before, paths) {
				t.Fatal("source selection changed paths")
			}
			if assertDomainError(t, err, want.Error) {
				return
			}
			if input.Recipe != nil {
				h := sha256.New()
				for _, p := range got {
					b, err := hex.DecodeString(unitsHex(p) + "0000")
					if err != nil {
						t.Fatal(err)
					}
					h.Write(b)
				}
				if len(got) != want.Result.Count || hex.EncodeToString(h.Sum(nil)) != want.Result.SHA {
					t.Fatalf("selected count=%d digest=%x", len(got), h.Sum(nil))
				}
			} else {
				var expectedHex []string
				if err := json.Unmarshal(want.Result.UTF16, &expectedHex); err != nil {
					t.Fatal(err)
				}
				actual := []string{}
				for _, p := range got {
					actual = append(actual, unitsHex(p))
				}
				if !reflect.DeepEqual(actual, expectedHex) {
					t.Fatalf("paths=%v want=%v", actual, expectedHex)
				}
			}
		})
	}
}
func TestTextOwnsUnits(t *testing.T) {
	source := []uint16{'a', 0xd800, 0xdc00, 0xdfff}
	text := NewText(source)
	source[0] = 'x'
	exported := text.Units()
	exported[1] = 'y'
	if !reflect.DeepEqual(text.Units(), []uint16{'a', 0xd800, 0xdc00, 0xdfff}) {
		t.Fatal("Text aliases construction/export")
	}
	if !strings.Contains(text.String(), "a") {
		t.Fatal("UTF8 display boundary")
	}
}
