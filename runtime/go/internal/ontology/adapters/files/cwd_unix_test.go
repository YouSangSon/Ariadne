//go:build darwin || linux

package ontologyfiles

import (
	corefiles "ariadne/runtime/internal/core/adapters/files"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestLogicalPWDParentMatchesNodePhysicalCwd(t *testing.T) {
	repository, err := filepath.Abs("../../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	physical := filepath.Join(root, "physical", "child")
	logical := filepath.Join(root, "logical", "alias")
	if err = os.MkdirAll(physical, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(logical), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(physical, logical); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "physical/ontology.json"), []byte(`{"schema_version":1,"terms":[],"relations":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "logical/ontology.json"), []byte(`{`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(physical, "local.txt"), []byte("physical local\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(physical)
	t.Setenv("PWD", logical)
	cwd, err := os.Getwd()
	if err != nil || cwd != logical {
		t.Fatalf("logical PWD fixture: %q %v", cwd, err)
	}
	script := `import {ontologyFiles} from '` + filepath.Join(repository, "modules/ontology/files.mjs") + `';ontologyFiles('../ontology.json').readDocument();console.log('read')`
	command := exec.Command("node", "--input-type=module", "-e", script)
	command.Env = os.Environ()
	data, e := command.CombinedOutput()
	if e != nil || string(data) != "read\n" {
		t.Fatalf("Node physical cwd: %q %v", data, e)
	}
	t.Run("reader-dot", func(t *testing.T) {
		script := `import {readProjectText} from '` + filepath.Join(repository, "core/infrastructure/project-files.mjs") + `';readProjectText('.','local.txt');console.log('read')`
		command := exec.Command("node", "--input-type=module", "-e", script)
		command.Env = os.Environ()
		data, e := command.CombinedOutput()
		if e != nil || string(data) != "read\n" {
			t.Fatalf("Node reader physical cwd: %q %v", data, e)
		}
		if _, e = (corefiles.Reader{}).ReadProjectText(".", "local.txt"); e != nil {
			t.Fatalf("Go reader logical PWD: %v", e)
		}
	})
	ports, e := New("../ontology.json", corefiles.Reader{})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = ports.ReadDocument(); e != nil {
		t.Fatalf("Go logical PWD selected another parent: %v", e)
	}
}
