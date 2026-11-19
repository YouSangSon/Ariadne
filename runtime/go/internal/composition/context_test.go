package composition

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNodeContextCLIGoldens(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		CLI []struct {
			ID, Command string
			Args        []string
			Files       []struct{ Path, Hex string }
		}
	}
	var expected struct {
		CLI []struct {
			ID             string
			Status         int
			Stdout, Stderr string
		}
	}
	for name, v := range map[string]any{"cases.json": &input, "expected.json": &expected} {
		data, e := os.ReadFile(filepath.Join(root, "contracts/context/files-cli-v1", name))
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(data, v); e != nil {
			t.Fatal(e)
		}
	}
	if len(input.CLI) != len(expected.CLI) {
		t.Fatal("CLI fixture inventory drift")
	}
	for i, c := range input.CLI {
		t.Run(c.ID, func(t *testing.T) {
			directory := t.TempDir()
			for _, f := range c.Files {
				path := filepath.Join(directory, f.Path)
				if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
					t.Fatal(e)
				}
				data, e := hex.DecodeString(f.Hex)
				if e != nil {
					t.Fatal(e)
				}
				if e = os.WriteFile(path, data, 0600); e != nil {
					t.Fatal(e)
				}
			}
			t.Chdir(directory)
			var out, errs bytes.Buffer
			code := Run(append([]string{c.Command}, c.Args...), &out, &errs)
			want := expected.CLI[i]
			if want.ID != c.ID || code != want.Status || out.String() != want.Stdout || errs.String() != want.Stderr {
				t.Fatalf("exit=%d want=%d\nstdout=%q want=%q\nstderr=%q want=%q", code, want.Status, out.String(), want.Stdout, errs.String(), want.Stderr)
			}
		})
	}
}
