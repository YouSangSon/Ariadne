//go:build darwin || linux

package files

import (
	"bytes"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"ariadne/runtime/internal/requirements/application"
	"golang.org/x/sys/unix"
)

func sourceTestOK(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestSourceContentReplaysInaccurateLengths(t *testing.T) {
	failure := errors.New("hash update failed")
	for _, tc := range []struct {
		name                      string
		actual, advertised, limit int64
		want                      error
	}{
		{"small overreported", 7, 100, 10, nil},
		{"spooled zero size", sourceChunkSize + 10, 0, sourceChunkSize + 10, nil},
		{"spooled positive underreported", sourceChunkSize + 10, 7, sourceChunkSize + 10, nil},
		{"unreliable size exceeds aggregate", sourceChunkSize + 10, 0, sourceChunkSize + 9, application.ErrSourceInputLimit},
		{"consumer failure after unlink", sourceChunkSize + 10, 0, sourceChunkSize + 10, failure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			temp := t.TempDir()
			t.Setenv("TMPDIR", temp)
			content := bytes.Repeat([]byte{0xff}, int(tc.actual))
			path := filepath.Join(t.TempDir(), "input")
			sourceTestOK(t, os.WriteFile(path, content, 0600))
			file, err := os.Open(path)
			sourceTestOK(t, err)
			defer file.Close()
			var spool *os.File
			calls := 0
			err = streamSourceContent(file, tc.advertised, tc.limit, func(reader io.Reader, size int64) error {
				calls++
				if size != tc.actual {
					t.Fatalf("got size %d, want %d", size, tc.actual)
				}
				spool, _ = reader.(*os.File)
				if (spool != nil) != (tc.actual > sourceChunkSize) {
					t.Fatal("unexpected replay storage")
				}
				if spool != nil {
					if _, err := os.Lstat(spool.Name()); !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("spool has a directory entry: %v", err)
					}
					info, err := spool.Stat()
					sourceTestOK(t, err)
					if info.Mode().Perm()&0077 != 0 {
						t.Fatalf("exposed spool permissions %o", info.Mode().Perm())
					}
				}
				actual, err := io.ReadAll(reader)
				sourceTestOK(t, err)
				if !bytes.Equal(actual, content) {
					t.Fatal("replay changed content")
				}
				return tc.want
			})
			if !errors.Is(err, tc.want) || (calls == 1) != (tc.want != application.ErrSourceInputLimit) {
				t.Fatalf("error=%v calls=%d, want error=%v", err, calls, tc.want)
			}
			if spool != nil {
				if _, err := spool.Stat(); !errors.Is(err, os.ErrClosed) {
					t.Fatalf("spool descriptor still open: %v", err)
				}
			}
			entries, err := os.ReadDir(temp)
			sourceTestOK(t, err)
			if len(entries) != 0 {
				t.Fatalf("unexpected temporary replay artifacts: %v", entries)
			}
		})
	}
}

func TestSourceContentUsesSequentialReadWhenPositioningIsUnsupported(t *testing.T) {
	read, write, err := os.Pipe()
	sourceTestOK(t, err)
	defer read.Close()
	_, err = write.WriteString("abc")
	sourceTestOK(t, err)
	sourceTestOK(t, write.Close())
	sourceTestOK(t, streamSourceContent(read, 0, 3, func(input io.Reader, size int64) error {
		got, err := io.ReadAll(input)
		sourceTestOK(t, err)
		if size != 3 || string(got) != "abc" {
			t.Fatalf("size=%d content=%q", size, got)
		}
		return nil
	}))
}

func TestSourceInputRejectsChangedDescriptor(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "input")
	sourceTestOK(t, os.WriteFile(path, []byte("first"), 0600))
	fd, err := openSourceRoot(root)
	sourceTestOK(t, err)
	defer unix.Close(fd)
	var read *os.File
	err = withSourceInput(fd, root, "input", 64, func(input application.StreamInput) error {
		read = input.Content.(*os.File)
		_, err := io.ReadAll(read)
		sourceTestOK(t, err)
		return os.Truncate(path, 2)
	})
	if !errors.Is(err, application.ErrSourceInputChanged) {
		t.Fatalf("changed input returned %v", err)
	}
	if _, err := read.Stat(); !errors.Is(err, os.ErrClosed) {
		t.Fatalf("changed input left its descriptor open: %v", err)
	}
}

func TestGitCommandBounds(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", root+string(os.PathListSeparator)+os.Getenv("PATH"))
	const both = "/bin/dd if=/dev/zero bs=1048576 count=2 2>/dev/null\n" +
		"/bin/dd if=/dev/zero bs=1048576 count=2 1>&2 2>/dev/null\n"
	for _, tc := range []struct {
		name, command string
		wantBytes     int
	}{
		{"stdout", "exec /bin/dd if=/dev/zero bs=1048576 count=5 2>/dev/null", 0},
		{"stderr", "exec /bin/dd if=/dev/zero bs=1048576 count=5 1>&2 2>/dev/null", 0},
		{"combined exact", both, 2 << 20},
		{"combined over", both + "printf x\nexit 1", 0},
		{"timeout", "exec /bin/sleep 30", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sourceTestOK(t, os.WriteFile(filepath.Join(root, "git"), []byte("#!/bin/sh\n"+tc.command+"\n"), 0700))
			start := time.Now()
			out, err := runSourceGit(root, "rev-parse", "--show-toplevel")
			if tc.wantBytes > 0 {
				if err != nil || len(out) != tc.wantBytes {
					t.Fatalf("command returned %d bytes and %v, want %d", len(out), err, tc.wantBytes)
				}
			} else if !errors.Is(err, errGitInspection) {
				t.Fatalf("command returned %v, want generic inspection error", err)
			}
			if elapsed := time.Since(start); elapsed > 15*time.Second {
				t.Fatalf("owned command survived the output or time bound for %v", elapsed)
			}
		})
	}
}

func TestGitCommandCollectsInheritedOutput(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", root+string(os.PathListSeparator)+os.Getenv("PATH"))
	git := filepath.Join(root, "git")
	sourceTestOK(t, os.WriteFile(git, []byte("#!/bin/sh\n( /bin/sleep 0.25; printf delayed ) &\nexit 0\n"), 0700))
	got, err := runSourceGit(root, "rev-parse", "--show-toplevel")
	if err != nil || got != "delayed" {
		t.Fatalf("inherited output %q, error %v", got, err)
	}
}

func TestGitCommandSeparatesUnbornFromBlockedInheritedOutput(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PATH", root+string(os.PathListSeparator)+os.Getenv("PATH"))
	git := filepath.Join(root, "git")
	sourceTestOK(t, os.WriteFile(git, []byte("#!/bin/sh\nexit 1\n"), 0700))
	_, err := runSourceGit(root, "rev-parse", "--verify", "--quiet", "HEAD")
	var status *exec.ExitError
	if !errors.As(err, &status) || status.ExitCode() != 1 {
		t.Fatalf("bare exit1 yielded %v", err)
	}

	pidPath := filepath.Join(root, "group")
	t.Setenv("ARIADNE_TEST_GIT_GROUP", pidPath)
	const script = "#!/bin/sh\nprintf '%s' \"$$\" > \"$ARIADNE_TEST_GIT_GROUP\"\n( /bin/sleep 30; printf late ) &\nexit 1\n"
	sourceTestOK(t, os.WriteFile(git, []byte(script), 0700))
	_, err = runSourceGit(root, "rev-parse", "--verify", "--quiet", "HEAD")
	pid, readErr := os.ReadFile(pidPath)
	sourceTestOK(t, readErr)
	group, parseErr := strconv.Atoi(string(pid))
	sourceTestOK(t, parseErr)
	t.Cleanup(func() { _ = unix.Kill(-group, unix.SIGKILL) })
	if !errors.Is(err, errGitInspection) {
		t.Fatalf("blocked inherited stream yielded %v, want inspection error", err)
	}

	deadline := time.Now().Add(time.Second)
	for {
		list, err := exec.Command("/bin/ps", "-axo", "pgid=,stat=").Output()
		sourceTestOK(t, err)
		running := false
		for line := range strings.SplitSeq(string(list), "\n") {
			columns := strings.Fields(line)
			if len(columns) == 2 && columns[0] == string(pid) && !strings.HasPrefix(columns[1], "Z") {
				running = true
				break
			}
		}
		if !running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a process from the timed-out Git group is still running")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
