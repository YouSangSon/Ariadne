//go:build darwin || linux

package contextfiles

import (
	corefiles "ariadne/runtime/internal/core/adapters/files"
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryReplacementsAndDescriptorCleanup(t *testing.T) {
	for _, kind := range []string{"unchanged", "symlink", "fifo", "directory", "close-error", "entry-symlink", "cap"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "skills")
			if err := os.Mkdir(path, 0700); err != nil {
				t.Fatal(err)
			}
			store := New(root, corefiles.Reader{})
			if kind == "symlink" || kind == "fifo" || kind == "directory" {
				store.observe = func(path string) {
					if err := os.Rename(path, path+".before"); err != nil {
						t.Fatal(err)
					}
					var err error
					switch kind {
					case "symlink":
						err = os.Symlink(path+".before", path)
					case "fifo":
						err = unix.Mkfifo(path, 0600)
					case "directory":
						err = os.Mkdir(path, 0700)
					}
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			if kind == "entry-symlink" {
				if err := os.Symlink("absent", filepath.Join(path, "link")); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "cap" {
				for i := 0; i < 101; i++ {
					if _, err := os.MkdirTemp(path, "entry-"); err != nil {
						t.Fatal(err)
					}
				}
			}
			var fd *os.File
			closeError := errors.New("test close failure")
			store.closeDirectory = func(f *os.File) error {
				fd = f
				err := f.Close()
				if kind == "close-error" {
					return errors.Join(err, closeError)
				}
				return err
			}
			names, err := store.ListSkills()
			if kind == "unchanged" {
				if err != nil || len(names) != 0 {
					t.Fatalf("empty directory: %v %v", names, err)
				}
			} else if err == nil || names != nil {
				t.Fatalf("replacement/error produced success: %v %v", names, err)
			}
			if kind == "close-error" && !errors.Is(err, closeError) {
				t.Fatalf("lost close error: %v", err)
			}
			if fd != nil {
				if _, err := fd.Stat(); !errors.Is(err, os.ErrClosed) {
					t.Fatalf("descriptor left open: %v", err)
				}
			}
		})
	}
}
func TestSkillFIFOUsesCoreRegularFilePolicy(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "skills", "alpha")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(path, "SKILL.md"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := New(root, corefiles.Reader{}).ReadSkill("alpha")
	if err == nil || err.Error() != "Project path must be a regular file" {
		t.Fatalf("skill FIFO: %v", err)
	}
}
