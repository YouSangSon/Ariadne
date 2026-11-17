package composition

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestExperimentalOntologyHelp(t *testing.T) {
	var out, stderr bytes.Buffer
	code := Run([]string{"ontology"}, &out, &stderr)
	if code != 0 || !bytes.Contains(out.Bytes(), []byte("Ariadne ontology inspect")) {
		t.Fatalf("ontology help: exit=%d stdout=%q stderr=%q", code, out.String(), stderr.String())
	}
}
func TestNodeFilesCLIGoldens(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		Files map[string]string
		Cases []struct {
			Name string
			Args []string
		}
	}
	var expected struct {
		Cases []struct {
			Name           string
			Status         int
			Stdout, Stderr string
		}
	}
	read := func(name string, v any) {
		t.Helper()
		data, e := os.ReadFile(filepath.Join(root, "contracts/ontology/files-cli-v1", name))
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(data, v); e != nil {
			t.Fatal(e)
		}
	}
	read("cases.json", &input)
	read("expected.json", &expected)
	if len(input.Cases) != len(expected.Cases) {
		t.Fatal("case inventory drift")
	}
	directory := t.TempDir()
	for name, body := range input.Files {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Chdir(directory)
	for i, c := range input.Cases {
		t.Run(c.Name, func(t *testing.T) {
			var out, errs bytes.Buffer
			code := Run(append([]string{"ontology"}, c.Args...), &out, &errs)
			want := expected.Cases[i]
			if want.Name != c.Name || code != want.Status || out.String() != want.Stdout || errs.String() != want.Stderr {
				t.Fatalf("exit=%d want=%d\nstdout=%q want=%q\nstderr=%q want=%q", code, want.Status, out.String(), want.Stdout, errs.String(), want.Stderr)
			}
		})
	}
}
