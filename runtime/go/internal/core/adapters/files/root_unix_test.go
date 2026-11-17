//go:build darwin || linux

package corefiles

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
)

func TestRootResolutionMatchesActualNode(t *testing.T) {
	repository, err := filepath.Abs("../../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"target-dotdot", "input-link-dotdot", "malformed-chain", "missing-decoded-target", "raw-stat-before-decode", "native-os-cycle"} {
		t.Run(kind, func(t *testing.T) {
			if runtime.GOOS != "linux" && (kind == "malformed-chain" || kind == "missing-decoded-target" || kind == "raw-stat-before-decode") {
				t.Skip("APFS rejects malformed native filenames; Linux native fixture")
			}
			root := t.TempDir()
			write := func(path, text string) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			link := func(target, path string) {
				t.Helper()
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			}
			selected := filepath.Join(root, "a")
			switch kind {
			case "native-os-cycle":
				link("b", selected)
				link("a", filepath.Join(root, "b"))
			case "target-dotdot", "input-link-dotdot":
				write(filepath.Join(root, "x/source.txt"), "lexical target parent\n")
				write(filepath.Join(root, "other/source.txt"), "OS traversed parent\n")
				write(filepath.Join(root, "source.txt"), "lexical input parent\n")
				if err := os.Mkdir(filepath.Join(root, "other/deep"), 0700); err != nil {
					t.Fatal(err)
				}
				link(filepath.Join(root, "other/deep"), filepath.Join(root, "x/link"))
				link("x/link/..", selected)
				if kind == "input-link-dotdot" {
					selected += "/.."
				}
			case "malformed-chain":
				write(filepath.Join(root, "raw/source.txt"), "raw target\n")
				write(filepath.Join(root, "chosen/source.txt"), "decoded intermediate chain\n")
				link("raw", filepath.Join(root, "\xe2\x82"))
				link("chosen", filepath.Join(root, "�"))
				link("\xe2\x82", selected)
			case "missing-decoded-target":
				write(filepath.Join(root, "\xe2\x82/source.txt"), "raw only\n")
				link("\xe2\x82", selected)
			case "raw-stat-before-decode":
				write(filepath.Join(root, "�/source.txt"), "decoded exists but raw target absent\n")
				link("\xe2\x82", selected)
			}
			script := `import {readProjectText} from './core/infrastructure/project-files.mjs';try{console.log(JSON.stringify({sha:readProjectText(process.argv[1],'source.txt').sha256}))}catch(e){console.log(JSON.stringify({code:e.code,error:e.message}))}`
			command := exec.Command("node", "--input-type=module", "-e", script, selected)
			command.Dir = repository
			data, e := command.CombinedOutput()
			if e != nil {
				t.Fatalf("Node root oracle: %s %v", data, e)
			}
			var want struct{ SHA, Code, Error string }
			if e = json.Unmarshal(data, &want); e != nil {
				t.Fatal(e)
			}
			got, e := (Reader{}).ReadProjectText(selected, "source.txt")
			if want.Code != "" {
				switch want.Code {
				case "ENOENT":
					if !errors.Is(e, syscall.ENOENT) {
						t.Fatalf("Node=%s Go=%v", data, e)
					}
				case "ELOOP":
					if !errors.Is(e, syscall.ELOOP) {
						t.Fatalf("Node=%s Go=%v", data, e)
					}
				default:
					t.Fatalf("unqualified Node errno %s", data)
				}
				return
			}
			if want.Error != "" {
				t.Fatalf("unqualified Node domain error %s", data)
			}
			if e != nil || got.SHA256 != want.SHA {
				t.Fatalf("Node=%s GoSHA=%s Goerror=%v", data, got.SHA256, e)
			}
		})
	}
}
