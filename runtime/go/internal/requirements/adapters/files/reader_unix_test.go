//go:build darwin || linux

package files_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"

	"ariadne/runtime/internal/requirements/adapters/files"
	"ariadne/runtime/internal/requirements/application"
	"golang.org/x/sys/unix"
)

const repository = "../../../../../.."

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestReadRequirement(t *testing.T) {
	const missing = "REQ must be a regular file, not a missing file or symlink"
	const ancestor = "Symbolic link ancestor is not allowed"
	const kind = "Source input must be a regular file or symbolic link"
	const limit = 1 << 20
	tests := []struct {
		name, layout string
		data         []byte
		want         string
		failure      string
	}{
		{"empty", "file", nil, "", ""},
		{"unicode and line endings", "file", []byte("\ufeff\ufeff한\r\n🙂\r\x00"), "\ufeff한\n🙂\r\x00", ""},
		{"invalid UTF8", "file", []byte{0xed, 0xa0, 0x80}, "", "REQ must be UTF-8 text"},
		{"exact byte bound", "file", bytes.Repeat([]byte{'x'}, limit), string(bytes.Repeat([]byte{'x'}, limit)), ""},
		{"size before UTF8", "file", bytes.Repeat([]byte{0xff}, limit+1), "", "File size exceeds 1 MiB"},
		{"missing leaf", "missing", nil, "", missing},
		{"file root", "root-file", nil, "", missing},
		{"nondirectory ancestor", "ancestor-file", nil, "", missing},
		{"ancestor link", "ancestor-link", nil, "", ancestor},
		{"leaf link", "leaf-link", nil, "", missing},
		{"dangling leaf", "dangling", nil, "", missing},
		{"directory leaf", "directory", nil, "", kind},
		{"FIFO leaf", "fifo", nil, "", kind},
		{"searchable directories", "execute-only", []byte("data"), "data", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			harness := filepath.Join(root, ".harness")
			dir := filepath.Join(harness, "reqs")
			leaf := filepath.Join(dir, "demo.yaml")
			switch tc.layout {
			case "root-file":
				root = filepath.Join(root, "plain")
				check(t, os.WriteFile(root, nil, 0600))
			case "ancestor-file":
				check(t, os.WriteFile(harness, nil, 0600))
			case "ancestor-link":
				check(t, os.Symlink(root, harness))
			default:
				check(t, os.MkdirAll(dir, 0700))
				switch tc.layout {
				case "file", "execute-only":
					check(t, os.WriteFile(leaf, tc.data, 0600))
					if tc.layout == "execute-only" {
						check(t, os.Chmod(dir, 0100))
						t.Cleanup(func() { check(t, os.Chmod(dir, 0700)) })
					}
				case "leaf-link":
					check(t, os.Symlink(root, leaf))
				case "dangling":
					check(t, os.Symlink("absent", leaf))
				case "directory":
					check(t, os.Mkdir(leaf, 0700))
				case "fifo":
					check(t, unix.Mkfifo(leaf, 0600))
				}
			}
			const observe = `import {requirementFiles} from './modules/requirements/files.mjs'
                import {createHash} from 'node:crypto'
                try {process.stdout.write(createHash('sha256').update(requirementFiles(process.argv[1]).readRequirement('demo')).digest('hex'))}
                catch (e) {process.stdout.write(e.message)}`
			node := exec.Command("node", "--input-type=module", "-e", observe, root)
			node.Dir = repository
			out, err := node.Output()
			check(t, err)
			expected := tc.failure
			if expected == "" {
				expected = fmt.Sprintf("%x", sha256.Sum256([]byte(tc.want)))
			}
			if string(out) != expected {
				t.Fatalf("Node read: %q, expected %q", out, expected)
			}
			body, err := files.LoadPorts(root).ReadRequirement("demo")
			if tc.failure != "" {
				if err == nil || err.Error() != tc.failure {
					t.Fatalf("got %v, want %q", err, tc.failure)
				}
			} else if err != nil || body.String() != tc.want {
				t.Fatalf("got %d UTF16 units, %v; want %d bytes", len(body.Units()), err, len(tc.want))
			}
			assertDescriptorsClosed(t, root, harness, dir, leaf)
		})
	}
}

// Only inspect identities created for this case; the Go runtime owns unrelated FDs.
func assertDescriptorsClosed(t *testing.T, paths ...string) {
	t.Helper()
	var owned []os.FileInfo
	for _, path := range paths {
		if info, err := os.Lstat(path); err == nil {
			owned = append(owned, info)
		}
	}
	entries, err := os.ReadDir("/dev/fd")
	check(t, err)
	for _, entry := range entries {
		fd, e := strconv.Atoi(entry.Name())
		if e != nil {
			continue
		}
		var stat unix.Stat_t
		if unix.Fstat(fd, &stat) != nil {
			continue
		}
		for _, info := range owned {
			st := info.Sys().(*syscall.Stat_t)
			if uint64(st.Dev) == uint64(stat.Dev) && st.Ino == stat.Ino {
				t.Fatalf("open file descriptor %d for %s", fd, info.Name())
			}
		}
	}
}

func TestLoadContractFromRetargetedRootMatchesNode(t *testing.T) {
	const id = "demo"
	root := t.TempDir()
	alias := filepath.Join(root, "project")
	ports := files.LoadPorts(alias)
	const fixture = `metadata:
  req_id: demo
  status: ready_for_routing
functional_contract:
  acceptance_criteria:
    - id: A1
      statement: TARGET
      verification: Observe the result
verification:
  evidence: []
`
	var previous string
	for i, name := range []string{"first", "second"} {
		project := filepath.Join(root, name)
		dir := filepath.Join(project, ".harness", "reqs")
		check(t, os.MkdirAll(dir, 0700))
		content := bytes.ReplaceAll([]byte(fixture), []byte("TARGET"), []byte(name))
		content = append([]byte{0xef, 0xbb, 0xbf}, bytes.ReplaceAll(content, []byte("\n"), []byte("\r\n"))...)
		check(t, os.WriteFile(filepath.Join(dir, id+".yaml"), content, 0600))
		if i > 0 {
			check(t, os.Remove(alias))
		}
		check(t, os.Symlink(project, alias))
		const program = "import {loadContract} from './modules/loop/contract.mjs'; console.log(JSON.stringify(loadContract(process.argv[1],process.argv[2])))"
		cmd := exec.Command("node", "--input-type=module", "-e", program, alias, id)
		cmd.Dir = repository
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("Node LoadContract: %v: %s", err, out)
		}
		var want struct {
			Hash, Status string
			Criteria     []json.RawMessage
		}
		check(t, json.Unmarshal(out, &want))
		got, err := application.LoadContract(ports, id)
		check(t, err)
		if got.Hash != want.Hash || got.Status != want.Status || len(got.Criteria) != len(want.Criteria) || got.Hash == previous {
			t.Fatalf("expected Node status %s, hash %s, criteria %d; got %s %s %d (previous %s)", want.Status, want.Hash, len(want.Criteria), got.Status, got.Hash, len(got.Criteria), previous)
		}
		previous = got.Hash
	}
}

func TestNodeRootAndAbsoluteLookupErrors(t *testing.T) {
	for _, name := range []string{"embedded-NUL", "pipe-link-child", "absolute-leaf-length"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			root, err := filepath.EvalSymlinks(root)
			check(t, err)
			id := "demo"
			switch name {
			case "embedded-NUL":
				dir := filepath.Join(root, ".harness", "reqs")
				check(t, os.MkdirAll(dir, 0700))
				check(t, os.WriteFile(filepath.Join(dir, "demo.yaml"), []byte("data"), 0600))
				root += "/bad\x00/.."
			case "pipe-link-child":
				check(t, unix.Mkfifo(filepath.Join(root, "pipe"), 0600))
				check(t, os.Symlink("pipe", filepath.Join(root, "alias")))
				root = filepath.Join(root, "alias", "child")
			case "absolute-leaf-length":
				for len(root) < unix.PathMax-130 {
					n := min(90, unix.PathMax-130-len(root)-1)
					if n < 1 {
						break
					}
					root = filepath.Join(root, strings.Repeat("r", n))
					check(t, os.Mkdir(root, 0700))
				}
				id = strings.Repeat("s", 160)
				dir := filepath.Join(root, ".harness", "reqs")
				check(t, os.MkdirAll(dir, 0700))
				anchor, err := os.OpenRoot(dir)
				check(t, err)
				check(t, anchor.WriteFile(id+".yaml", []byte("data"), 0600))
				check(t, anchor.Close())
			}
			const script = `import {requirementFiles} from './modules/requirements/files.mjs'
                try { requirementFiles(JSON.parse(process.argv[1])).readRequirement(process.argv[2]); process.stdout.write('OK') }
                catch(e) { process.stdout.write(e.code ?? e.message) }`
			arg, err := json.Marshal(root)
			check(t, err)
			cmd := exec.Command("node", "--input-type=module", "-e", script, string(arg), id)
			cmd.Dir = repository
			oracle, err := cmd.CombinedOutput()
			check(t, err)
			_, err = files.LoadPorts(root).ReadRequirement(id)
			switch string(oracle) {
			case "ERR_INVALID_ARG_VALUE":
				if !errors.Is(err, unix.EINVAL) {
					t.Fatalf("node rejected invalid path; Go: %v", err)
				}
			case "ENAMETOOLONG":
				if !errors.Is(err, unix.ENAMETOOLONG) {
					t.Fatalf("node refused overlong path; Go: %v", err)
				}
			case "REQ must be a regular file, not a missing file or symlink":
				if err == nil || err.Error() != string(oracle) {
					t.Fatalf("node: %s; Go: %v", oracle, err)
				}
			default:
				t.Fatalf("unexpected Node reference result: %s", oracle)
			}
		})
	}
}
