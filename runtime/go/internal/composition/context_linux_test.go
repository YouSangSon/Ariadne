//go:build linux

package composition

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestLinuxNativeCwdNodeBoundaries(t *testing.T) {
	repository, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	rawRoot := filepath.Join(root, "cwd-\xe2\x82")
	decoded := filepath.Join(root, "cwd-�")
	if err = os.Mkdir(rawRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(decoded, ".harness"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(decoded, ".harness/decisions.md"), []byte("- decoded cwd\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(decoded, "sub"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(decoded, "sub/ontology.json"), []byte(`{"schema_version":1,"terms":[],"relations":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(rawRoot)
	for _, c := range []struct {
		name, script, command string
		args                  []string
	}{
		{"default-context", "lib/context-pack.mjs", "context", nil},
		{"dot-context", "lib/context-pack.mjs", "context", []string{"--root", "."}},
		{"ontology-resolve-before-reader", "modules/ontology/cli.mjs", "ontology", []string{"inspect", "--file", "sub/ontology.json"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			command := exec.Command("node", append([]string{filepath.Join(repository, c.script)}, c.args...)...)
			command.Dir = rawRoot
			var expectedErr bytes.Buffer
			command.Stderr = &expectedErr
			expectedOut, e := command.Output()
			wantCode := 0
			if e != nil {
				if exit, ok := e.(*exec.ExitError); ok {
					wantCode = exit.ExitCode()
				} else {
					t.Fatal(e)
				}
			}
			var out, errs bytes.Buffer
			gotCode := Run(append([]string{c.command}, c.args...), &out, &errs)
			if gotCode != wantCode || !bytes.Equal(out.Bytes(), expectedOut) || errs.String() != expectedErr.String() {
				t.Fatalf("Go exit=%d stdout=%q stderr=%q; Node exit=%d stdout=%q stderr=%q", gotCode, out.String(), errs.String(), wantCode, expectedOut, expectedErr.String())
			}
		})
	}
}
