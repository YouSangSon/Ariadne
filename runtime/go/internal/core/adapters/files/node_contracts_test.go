//go:build darwin || linux

package corefiles

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestActualNodeReaderGoldens(t *testing.T) {
	root, err := filepath.Abs("../../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		Files map[string]string
		Bytes map[string]string
	}
	var expected struct {
		Reader []struct{ Path, SHA256, Bytes, Error string }
	}
	load := func(name string, v any) {
		t.Helper()
		data, e := os.ReadFile(filepath.Join(root, "contracts/ontology/files-cli-v1", name))
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(data, v); e != nil {
			t.Fatal(e)
		}
	}
	load("cases.json", &input)
	load("expected.json", &expected)
	directory := t.TempDir()
	for name, body := range input.Files {
		write(t, filepath.Join(directory, name), []byte(body))
	}
	for name, body := range input.Bytes {
		data, e := base64.StdEncoding.DecodeString(body)
		if e != nil {
			t.Fatal(e)
		}
		write(t, filepath.Join(directory, name), data)
	}
	for _, c := range expected.Reader {
		t.Run(c.Path, func(t *testing.T) {
			got, e := (Reader{}).ReadProjectText(directory, c.Path)
			if c.Error != "" {
				if e == nil || e.Error() != c.Error {
					t.Fatalf("error=%v want=%q", e, c.Error)
				}
				return
			}
			if e != nil || hex.EncodeToString(got.Bytes) != c.Bytes || got.SHA256 != c.SHA256 {
				t.Fatalf("got=%+v err=%v", got, e)
			}
		})
	}
}
