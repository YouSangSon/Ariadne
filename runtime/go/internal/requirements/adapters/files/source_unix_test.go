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
	"slices"
	"strings"
	"testing"

	"ariadne/runtime/internal/requirements/adapters/files"
	"ariadne/runtime/internal/requirements/application"
	"golang.org/x/sys/unix"
)

func sourceGit(t *testing.T, root string, args ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", root}, args...)...)
	out, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", args[0], err, out)
	}
	return strings.TrimSpace(string(out))
}

func initSourceRepo(t *testing.T) string {
	t.Helper()
	for _, key := range []string{"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"} {
		if value, exists := os.LookupEnv(key); exists {
			check(t, os.Unsetenv(key))
			t.Cleanup(func() { check(t, os.Setenv(key, value)) })
		}
	}
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	root := t.TempDir()
	sourceGit(t, root, "init", "-q", "--template=")
	return root
}

func TestSourceStateStreamsGitInputs(t *testing.T) {
	root := initSourceRepo(t)
	binary := bytes.Repeat([]byte{0, 0xff, 'a', '\n', 0x80}, (1<<20)/5+1)
	for _, dir := range []string{".harness/reqs", ".harness/handoff", "nested/child", "node_modules"} {
		check(t, os.MkdirAll(filepath.Join(root, dir), 0700))
	}
	for _, name := range []string{"deleted", ".harness/reqs/demo.yaml", ".harness/handoff/private", "node_modules/dep"} {
		check(t, os.WriteFile(filepath.Join(root, name), []byte("excluded or deleted"), 0600))
	}
	sourceGit(t, root, "add", "--", "deleted", ".harness/reqs/demo.yaml")
	sourceGit(t, root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
	head := sourceGit(t, root, "rev-parse", "HEAD")
	check(t, os.Remove(filepath.Join(root, "deleted")))
	check(t, os.WriteFile(filepath.Join(root, "binary"), binary, 0600))
	check(t, os.Chmod(filepath.Join(root, "binary"), 0754))
	check(t, os.Symlink("absent-\xf0\x9f\x92", filepath.Join(root, "link")))
	link, err := os.Lstat(filepath.Join(root, "link"))
	check(t, err)
	check(t, os.WriteFile(filepath.Join(root, "nested/child/input"), []byte("nested"), 0600))
	check(t, os.WriteFile(filepath.Join(root, "\U0001f9ea"), []byte("A"), 0600))
	check(t, os.WriteFile(filepath.Join(root, "\ue000"), []byte("B"), 0600))

	h := sha256.New()
	fmt.Fprintf(h, "[\"binary\",\"file\",492,%d]\n", len(binary))
	h.Write(binary)
	fmt.Fprintf(h, "[\"deleted\",\"missing\",null,0]\n[\"link\",\"symlink\",%d,10]\nabsent-�", link.Mode().Perm())
	fmt.Fprint(h, "[\"nested/child/input\",\"file\",384,6]\nnested")
	fmt.Fprint(h, "[\"🧪\",\"file\",384,1]\nA[\"\ue000\",\"file\",384,1]\nB")
	want := fmt.Sprintf("%x", h.Sum(nil))
	id := "demo"
	alias := filepath.Join(t.TempDir(), "root")
	check(t, os.Symlink(root, alias))
	t.Setenv("TMPDIR", filepath.Join(root, "unused-temporary-directory"))
	got, err := files.SourceState(alias, &id)
	if err != nil {
		t.Fatalf("Git inputs must include the %d-byte file: %v", len(binary), err)
	}
	names := sourceNames(got)
	if got.Hash != want || got.Head == nil || *got.Head != head ||
		!slices.Equal(names, []string{"binary", "deleted", "link", "nested/child/input", "🧪", "\ue000"}) {
		t.Fatalf("source hash=%s head=%v files=%q; want hash=%s head=%s", got.Hash, got.Head, names, want, head)
	}
	assertSourceNode(t, alias, &id, got)
	assertDescriptorsClosed(t, root, filepath.Join(root, "binary"), filepath.Join(root, "nested"), filepath.Join(root, "nested/child"))
}

func TestSourceStateAggregateSizeBound(t *testing.T) {
	root := initSourceRepo(t)
	const half = 32 << 20
	names := []string{"a", "b"}
	for _, name := range names {
		path := filepath.Join(root, name)
		check(t, os.WriteFile(path, nil, 0600))
		check(t, os.Truncate(path, half))
	}
	h := sha256.New()
	zero := make([]byte, 64<<10)
	for _, name := range names {
		fmt.Fprintf(h, "[%q,\"file\",384,%d]\n", name, half)
		for remaining := half; remaining > 0; remaining -= len(zero) {
			h.Write(zero)
		}
	}
	want := fmt.Sprintf("%x", h.Sum(nil))
	got, err := files.SourceState(root, nil)
	check(t, err)
	if got.Head != nil || got.Hash != want || !slices.Equal(sourceNames(got), names) {
		t.Fatalf("exactly 64 MiB: head=%v hash=%s, want %s, files=%q", got.Head, got.Hash, want, sourceNames(got))
	}
	check(t, os.Truncate(filepath.Join(root, "b"), half+1))
	got, err = files.SourceState(root, nil)
	if !errors.Is(err, application.ErrSourceInputLimit) {
		t.Fatalf("64 MiB + 1: got %v", err)
	}
	assertNoSourceResult(t, got)
	assertDescriptorsClosed(t, root, filepath.Join(root, "a"), filepath.Join(root, "b"))
}

func TestSourceStateRejectsSpecialInputs(t *testing.T) {
	for _, test := range []struct {
		name, failure string
		setup         func(*testing.T, string)
	}{
		{"FIFO leaf", "Source input must be a regular file or symbolic link", func(t *testing.T, path string) {
			check(t, unix.Mkfifo(path, 0600))
		}},
		{"link ancestor", "Symbolic link ancestor is not allowed", func(t *testing.T, path string) {
			check(t, os.Remove(filepath.Dir(path)))
			check(t, os.Symlink(t.TempDir(), filepath.Dir(path)))
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := initSourceRepo(t)
			path := filepath.Join(root, "nested/leaf")
			check(t, os.WriteFile(filepath.Join(root, "a"), []byte("first valid input"), 0600))
			check(t, os.Mkdir(filepath.Dir(path), 0700))
			check(t, os.WriteFile(path, []byte("tracked input"), 0600))
			sourceGit(t, root, "add", "--", "nested/leaf")
			check(t, os.Remove(path))
			test.setup(t, path)
			got, err := files.SourceState(root, nil)
			if err == nil || err.Error() != test.failure {
				t.Fatalf("got %v, want %q", err, test.failure)
			}
			assertNoSourceResult(t, got)
			assertDescriptorsClosed(t, root, filepath.Join(root, "a"), filepath.Dir(path), path)
		})
	}
}

func TestSourceStateCurrentRepository(t *testing.T) {
	root := os.Getenv("ARIADNE_TEST_SOURCE_STATE_ROOT")
	if root == "" {
		t.Skip("set ARIADNE_TEST_SOURCE_STATE_ROOT to a stable Ariadne checkout")
	}
	got, err := files.SourceState(root, nil)
	check(t, err)
	assertSourceNode(t, root, nil, got)
	head := "unborn"
	if got.Head != nil {
		head = *got.Head
	}
	t.Logf("Node and Go agree on %d paths at HEAD %s, hash %s", len(got.Files), head, got.Hash)
}

func sourceNames(result application.SourceStateResult) []string {
	names := make([]string, 0, len(result.Files))
	for _, path := range result.Files {
		names = append(names, path.String())
	}
	return names
}

func assertSourceNode(t *testing.T, root string, reqID *string, got application.SourceStateResult) {
	t.Helper()
	const program = `import { sourceState } from './modules/loop/contract.mjs'
process.stdout.write(JSON.stringify(sourceState(process.argv[1], {reqId: process.argv[2]})))`
	args := []string{"--input-type=module", "-e", program, root}
	if reqID != nil {
		args = append(args, *reqID)
	}
	cmd := exec.Command("node", args...)
	cmd.Dir = repository
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Node sourceState: %v\n%s", err, out)
	}
	var want struct {
		Hash  string
		Head  *string
		Files []string
	}
	check(t, json.Unmarshal(out, &want))
	if got.Hash != want.Hash || (got.Head == nil) != (want.Head == nil) ||
		got.Head != nil && *got.Head != *want.Head || !slices.Equal(sourceNames(got), want.Files) {
		t.Fatalf("source state differs from Node: Go hash=%s (%d files), Node hash=%s (%d files)", got.Hash, len(got.Files), want.Hash, len(want.Files))
	}
}

func assertNoSourceResult(t *testing.T, got application.SourceStateResult) {
	t.Helper()
	if got.Hash != "" || got.Head != nil || got.Files != nil {
		t.Fatalf("partial source result: %#v", got)
	}
}
