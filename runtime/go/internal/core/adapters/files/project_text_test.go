//go:build darwin || linux

package corefiles

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func write(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0700); err != nil {
		t.Fatal(err)
	}
}
func countFD(t *testing.T) int {
	t.Helper()
	path := "/dev/fd"
	if _, err := os.Stat("/proc/self/fd"); err == nil {
		path = "/proc/self/fd"
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}
func TestProjectTextRealFiles(t *testing.T) {
	root := t.TempDir()
	for _, tt := range []struct {
		name string
		data []byte
		want string
	}{
		{"executable", []byte("#!/bin/sh\ntext"), ""}, {"bom", []byte("\xef\xbb\xbfhello"), ""}, {"empty", []byte{}, ""}, {"max", bytes.Repeat([]byte("a"), 1<<20), ""},
		{"oversize", bytes.Repeat([]byte("a"), (1<<20)+1), "File size exceeds 1 MiB"}, {"nul", []byte("a\x00b"), "Binary project files are denied"}, {"utf8", []byte{255}, "Project files must contain UTF-8 text"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			write(t, filepath.Join(root, tt.name), tt.data)
			got, err := (Reader{}).ReadProjectText(root, tt.name)
			if tt.want != "" {
				if err == nil || err.Error() != tt.want {
					t.Fatal(err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(tt.data)
			if !bytes.Equal(got.Bytes, tt.data) || got.SHA256 != hex.EncodeToString(sum[:]) || got.Identity.Inode == 0 {
				t.Fatal(got)
			}
		})
	}
	for _, p := range []string{"../x", ".env", "file.KEY"} {
		if _, err := (Reader{}).ReadProjectText(filepath.Join(root, "missing"), p); err == nil || strings.Contains(err.Error(), "no such") {
			t.Fatal("validate path before root", err)
		}
	}
	if _, err := (Reader{}).ReadProjectText(root, "missing"); err == nil || err.Error() != "Project file does not exist" {
		t.Fatal(err)
	}
	// Root names and symlink aliases are canonicalized, not project-path checked.
	protected := filepath.Join(root, ".ssh")
	if err := os.Mkdir(protected, 0700); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(protected, "text"), []byte("yes"))
	alias := filepath.Join(root, "root-link")
	if err := os.Symlink(protected, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := (Reader{}).ReadProjectText(alias, "text"); err != nil {
		t.Fatal(err)
	}
}
func TestRejectNonRegularAndAllSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	write(t, filepath.Join(outside, "file"), []byte("outside"))
	write(t, filepath.Join(root, "file"), []byte("inside"))
	for _, kind := range []string{"internal", "outside", "dangling"} {
		target := filepath.Join(root, "file")
		if kind == "outside" {
			target = filepath.Join(outside, "file")
		}
		if kind == "dangling" {
			target = filepath.Join(outside, "missing")
		}
		name := "leaf-" + kind
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
		if _, err := (Reader{}).ReadProjectText(root, name); err == nil || err.Error() != "Symbolic links are denied" {
			t.Fatal(kind, err)
		}
		dirTarget := root
		if kind == "outside" {
			dirTarget = outside
		}
		if kind == "dangling" {
			dirTarget = filepath.Join(outside, "missing")
		}
		name = "dir-" + kind
		if err := os.Symlink(dirTarget, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
		if _, err := (Reader{}).ReadProjectText(root, name+"/file"); err == nil || err.Error() != "Symbolic links are denied" {
			t.Fatal(kind, err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "dir"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(root, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"dir", "fifo", "fifo/x", "file/x"} {
		if _, err := (Reader{}).ReadProjectText(root, p); err == nil {
			t.Fatal(p)
		}
	}
	listener, err := unix.Socket(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(listener)
	socketRoot, err := os.MkdirTemp("/tmp", "ariadne-g1b-socket-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(socketRoot); err != nil {
			t.Error(err)
		}
	})
	socket := filepath.Join(socketRoot, "socket")
	if err = unix.Bind(listener, &unix.SockaddrUnix{Name: socket}); err != nil {
		t.Fatal(err)
	}
	if _, err := (Reader{}).ReadProjectText(socketRoot, "socket"); err == nil {
		t.Fatal("socket accepted")
	}
}
func TestReadDriftAndCleanup(t *testing.T) {
	for _, stage := range []string{"read-before", "read-after"} {
		for _, change := range []string{"growth", "inode", "same-size"} {
			t.Run(stage+"/"+change, func(t *testing.T) {
				root := t.TempDir()
				file := filepath.Join(root, "text")
				write(t, file, []byte("text"))
				before := countFD(t)
				r := Reader{observe: func(s, p string) {
					if s != stage {
						return
					}
					switch change {
					case "growth":
						write(t, file, bytes.Repeat([]byte("a"), (1<<20)+1))
					case "inode":
						if err := os.Rename(file, file+".old"); err != nil {
							t.Fatal(err)
						}
						write(t, file, []byte("new!"))
					case "same-size":
						write(t, file, []byte("next"))
						if err := os.Chtimes(file, time.Unix(123, 0), time.Unix(123, 0)); err != nil {
							t.Fatal(err)
						}
					}
				}}
				if _, err := r.ReadProjectText(root, "text"); err == nil {
					t.Fatal("observed drift accepted")
				}
				if after := countFD(t); after != before {
					t.Fatalf("FD leak %d -> %d", before, after)
				}
			})
		}
	}
	root := t.TempDir()
	write(t, filepath.Join(root, "text"), []byte("x"))
	before := countFD(t)
	closed := map[int]int{}
	sentinel := errors.New("observed close failure")
	r := Reader{closeFD: func(fd int) error {
		closed[fd]++
		if err := unix.Close(fd); err != nil {
			t.Fatal(err)
		}
		return sentinel
	}}
	if _, err := r.ReadProjectText(root, "text"); !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	for _, n := range closed {
		if n != 1 {
			t.Fatal("double close", closed)
		}
	}
	if countFD(t) != before {
		t.Fatal("close failure leaked")
	}
	deep := root
	for range 40 {
		deep = filepath.Join(deep, "d")
		if err := os.Mkdir(deep, 0700); err != nil {
			t.Fatal(err)
		}
	}
	write(t, filepath.Join(deep, "text"), []byte("deep"))
	max := before
	r = Reader{observe: func(s, p string) {
		if n := countFD(t); n > max {
			max = n
		}
	}}
	if _, err := r.ReadProjectText(root, strings.Repeat("d/", 40)+"text"); err != nil {
		t.Fatal(err)
	}
	if max > before+3 || countFD(t) != before {
		t.Fatalf("FD count depth growth: %d max %d after %d", before, max, countFD(t))
	}
}
func TestPreopenReplacementCannotHang(t *testing.T) {
	if value := os.Getenv("ARIADNE_FILES_RACE_CASE"); value != "" {
		runReplacementChild(t, value)
		return
	}
	for _, stage := range []string{"root", "ancestor", "leaf"} {
		for _, kind := range []string{"fifo", "symlink", "inode"} {
			t.Run(stage+"/"+kind, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				exe, err := os.Executable()
				if err != nil {
					t.Fatal(err)
				}
				cmd := exec.CommandContext(ctx, exe, "-test.run=^TestPreopenReplacementCannotHang$", "-test.v")
				cmd.Env = append(os.Environ(), "ARIADNE_FILES_RACE_CASE="+stage+"/"+kind, "ARIADNE_FILES_RACE_ROOT="+t.TempDir())
				out, err := cmd.CombinedOutput()
				if err != nil {
					t.Fatalf("child killed/waited=%v deadline=%v output=%s", err, ctx.Err(), out)
				}
				if cmd.ProcessState == nil || !cmd.ProcessState.Exited() {
					t.Fatal("child not reaped")
				}
			})
		}
	}
}
func runReplacementChild(t *testing.T, value string) {
	parts := strings.Split(value, "/")
	stage, kind := parts[0], parts[1]
	base := os.Getenv("ARIADNE_FILES_RACE_ROOT")
	root := filepath.Join(base, "root")
	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(nested, "text")
	write(t, file, []byte("old"))
	before := countFD(t)
	done := false
	r := Reader{observe: func(s, p string) {
		if done {
			return
		}
		target := ""
		if stage == "root" && s == "root-before-open" && p == "root" {
			target = root
		}
		if stage == "ancestor" && s == "ancestor-before-open" {
			target = nested
		}
		if stage == "leaf" && s == "leaf-before-open" {
			target = file
		}
		if target == "" {
			return
		}
		done = true
		if err := os.Rename(target, target+".old"); err != nil {
			t.Fatal(err)
		}
		switch kind {
		case "fifo":
			if err := unix.Mkfifo(target, 0600); err != nil {
				t.Fatal(err)
			}
		case "symlink":
			if err := os.Symlink(target+".old", target); err != nil {
				t.Fatal(err)
			}
		case "inode":
			if stage == "leaf" {
				write(t, target, []byte("new"))
			} else {
				if err := os.Mkdir(target, 0700); err != nil {
					t.Fatal(err)
				}
			}
		}
	}}
	if _, err := r.ReadProjectText(root, "nested/text"); err == nil {
		t.Fatal("replacement accepted")
	}
	if !done {
		t.Fatal("hook not exercised")
	}
	if countFD(t) != before {
		t.Fatal("child FD leak")
	}
}
