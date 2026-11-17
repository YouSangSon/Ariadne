//go:build linux

package contextfiles

import (
	corefiles "ariadne/runtime/internal/core/adapters/files"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLinuxNodeNativeNamesAndCanonicalRoot(t *testing.T) {
	version, err := exec.Command("node", "--version").Output()
	if err != nil || string(version) != "v24.22.2\n" {
		t.Fatalf("native Node oracle profile: %q %v", version, err)
	}
	repository, err := filepath.Abs("../../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(repository, "contracts/context/files-cli-v1/cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		Cases []fixtureCase `json:"native_linux"`
	}
	if err = json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	for _, c := range input.Cases {
		t.Run(c.ID, func(t *testing.T) {
			root := t.TempDir()
			materialize(t, root, c.Files)
			script := `import {contextFiles} from './modules/context/files.mjs';const [root,method]=process.argv.slice(1);console.log(JSON.stringify(contextFiles(root)[method]()))`
			command := exec.Command("node", "--input-type=module", "-e", script, root, c.Method)
			command.Dir = repository
			data, e := command.CombinedOutput()
			if e != nil {
				t.Fatalf("Node names: %s %v", data, e)
			}
			var want any
			if e = json.Unmarshal(data, &want); e != nil {
				t.Fatal(e)
			}
			value, e := observe(New(root, corefiles.Reader{}), c)
			if e != nil {
				t.Fatal(e)
			}
			gotJSON, _ := json.Marshal(value)
			var got any
			json.Unmarshal(gotJSON, &got)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("native filename decode: Go=%s Node=%s", gotJSON, data)
			}
		})
	}
	t.Run("canonical-root", func(t *testing.T) {
		root := t.TempDir()
		rawRoot := filepath.Join(root, "root-\xe2\x82")
		decoded := filepath.Join(root, "root-�")
		for path, text := range map[string]string{rawRoot: "raw", decoded: "decoded"} {
			if err := os.MkdirAll(filepath.Join(path, "skills/alpha"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(path, "skills/alpha/SKILL.md"), []byte("---\nname: alpha\ndescription: "+text+"\n---\nbody\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		link := filepath.Join(root, "root-link")
		if err := os.Symlink(rawRoot, link); err != nil {
			t.Fatal(err)
		}
		script := `import {readProjectText} from './core/infrastructure/project-files.mjs';console.log(JSON.stringify(readProjectText(process.argv[1],'skills/alpha/SKILL.md').sha256))`
		command := exec.Command("node", "--input-type=module", "-e", script, link)
		command.Dir = repository
		data, e := command.CombinedOutput()
		if e != nil {
			t.Fatalf("Node canonical root: %s %v", data, e)
		}
		var want string
		if e = json.Unmarshal(data, &want); e != nil {
			t.Fatal(e)
		}
		got, e := (corefiles.Reader{}).ReadProjectText(link, "skills/alpha/SKILL.md")
		if e != nil {
			t.Fatal(e)
		}
		if got.SHA256 != want {
			t.Fatalf("canonical root Go SHA=%s Node SHA=%s", got.SHA256, want)
		}
	})
	t.Run("decoded-root-is-symlink", func(t *testing.T) {
		root := t.TempDir()
		rawRoot := filepath.Join(root, "root-\xe2\x82")
		decoded := filepath.Join(root, "root-�")
		target := filepath.Join(root, "target")
		for path, text := range map[string]string{rawRoot: "raw", target: "decoded alias target"} {
			if err := os.MkdirAll(filepath.Join(path, "skills/alpha"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(path, "skills/alpha/SKILL.md"), []byte("---\nname: alpha\ndescription: "+text+"\n---\nbody\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.Symlink(target, decoded); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(root, "root-link")
		if err := os.Symlink(rawRoot, link); err != nil {
			t.Fatal(err)
		}
		script := `import {readProjectText} from './core/infrastructure/project-files.mjs';console.log(JSON.stringify(readProjectText(process.argv[1],'skills/alpha/SKILL.md').sha256))`
		command := exec.Command("node", "--input-type=module", "-e", script, link)
		command.Dir = repository
		data, e := command.CombinedOutput()
		if e != nil {
			t.Fatalf("Node decoded alias root: %s %v", data, e)
		}
		var want string
		if e = json.Unmarshal(data, &want); e != nil {
			t.Fatal(e)
		}
		got, e := (corefiles.Reader{}).ReadProjectText(link, "skills/alpha/SKILL.md")
		if e != nil {
			t.Fatal(e)
		}
		if got.SHA256 != want {
			t.Fatalf("decoded alias root Go SHA=%s Node SHA=%s", got.SHA256, want)
		}
	})
}
