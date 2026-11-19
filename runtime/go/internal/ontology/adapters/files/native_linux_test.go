//go:build linux

package ontologyfiles

import (
	corefiles "ariadne/runtime/internal/core/adapters/files"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestLinuxNativeCwdResolveMatchesNode(t *testing.T) {
	repository, err := filepath.Abs("../../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	rawRoot := filepath.Join(root, "cwd-\xe2\x82")
	decoded := filepath.Join(root, "cwd-�")
	if err = os.Mkdir(rawRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(decoded, "sub"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(decoded, "sub/ontology.json"), []byte(`{"schema_version":1,"terms":[],"relations":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	script := `import {ontologyFiles} from '` + filepath.Join(repository, "modules/ontology/files.mjs") + `';ontologyFiles('sub/ontology.json').readDocument();console.log('read')`
	command := exec.Command("node", "--input-type=module", "-e", script)
	command.Dir = rawRoot
	data, e := command.CombinedOutput()
	if e != nil || string(data) != "read\n" {
		t.Fatalf("Node resolve: %q %v", data, e)
	}
	t.Chdir(rawRoot)
	ports, e := New("sub/ontology.json", corefiles.Reader{})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = ports.ReadDocument(); e != nil {
		t.Fatalf("Go cannot read Node-resolved manifest: %v", e)
	}
}
