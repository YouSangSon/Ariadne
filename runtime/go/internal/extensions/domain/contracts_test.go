package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtures = "../../../../../contracts/extensions/v1/fixtures"

func TestManifestFixtures(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(fixtures, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		File, Kind string
		Valid      bool
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if c.Kind != "manifest" {
			continue
		}
		t.Run(c.File, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fixtures, c.File))
			if err != nil {
				t.Fatal(err)
			}
			got, err := ParseManifest(data)
			if (err == nil) != c.Valid {
				t.Fatalf("valid=%v error=%v", c.Valid, err)
			}
			if c.Valid && (got.ExtensionID != "ariadne/team-report" || got.World != World || got.SDKMajor != 1) {
				t.Fatalf("unexpected manifest: %+v", got)
			}
		})
	}
}

func TestManifestByteLimit(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(fixtures, "manifest-valid.json"))
	if err != nil {
		t.Fatal(err)
	}
	padded := append(data, []byte(strings.Repeat(" ", MaxManifestBytes-len(data)))...)
	if _, err := ParseManifest(padded); err != nil {
		t.Fatalf("exact byte limit: %v", err)
	}
	if _, err := ParseManifest(append(padded, ' ')); err == nil {
		t.Fatal("accepted manifest above byte limit")
	}
}

func TestStrictJSONAmbiguity(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(fixtures, "manifest-valid.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		data []byte
	}{
		{"trailing value", append(append([]byte{}, data...), []byte(" {}")...)},
		{"trailing garbage", append(append([]byte{}, data...), 'x')},
		{"wrong root", []byte("[]")},
		{"null root", []byte("null")},
		{"escaped duplicate", []byte(`{"schemaVersion":1,"schema\u0056ersion":1}`)},
		{"fractional integer", []byte(strings.Replace(string(data), `"schemaVersion": 1`, `"schemaVersion": 1.000000000000000000001`, 1))},
		{"unpaired low surrogate", []byte(strings.Replace(string(data), "Team evaluation summary", `\udfff`, 1))},
		{"deep input", []byte(strings.Repeat("[", 18) + "1" + strings.Repeat("]", 18))},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := ParseManifest(test.data); err == nil {
				t.Fatal("accepted ambiguous or invalid manifest")
			}
		})
	}
	for _, version := range []string{"1.0", "1e0", "100e-2"} {
		if _, err := ParseManifest([]byte(strings.Replace(string(data), `"schemaVersion": 1`, `"schemaVersion": `+version, 1))); err != nil {
			t.Fatalf("JSON Schema integer representation %s: %v", version, err)
		}
	}
	paired := strings.Replace(string(data), "Team evaluation summary", `\ud83d\ude00`, 1)
	if _, err := ParseManifest([]byte(paired)); err != nil {
		t.Fatalf("valid surrogate pair: %v", err)
	}
}

func TestBoundedInteger(t *testing.T) {
	for _, number := range []string{"1e999999999999999999999", "1e-999999999999999999999", "1.000000000000000000001", "9223372036854775808"} {
		if _, err := boundedInteger(number); err == nil {
			t.Fatalf("accepted %s", number)
		}
	}
	for _, number := range []string{"0e999999999999999999999", "-0e-999999999999999999999"} {
		if got, err := boundedInteger(number); err != nil || got != "0" {
			t.Fatalf("zero: %s %v", got, err)
		}
	}
}
