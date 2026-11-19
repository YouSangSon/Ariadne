//go:build darwin || linux

package files

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"ariadne/runtime/internal/platform/nodepath"
	"ariadne/runtime/internal/requirements/application"
	"ariadne/runtime/internal/requirements/domain"
	"golang.org/x/sys/unix"
	"golang.org/x/text/encoding/unicode"
)

var errGitInspection = errors.New("Git repository inspection failed")

func inspectSourceGit(directory string) (application.GitState, error) {
	top, err := runSourceGit(directory, "rev-parse", "--show-toplevel")
	if err != nil {
		return application.GitState{}, errGitInspection
	}
	root, err := nodepath.RealPath(trimGitText(top))
	if err != nil || root != directory {
		return application.GitState{}, errGitInspection
	}
	list, err := runSourceGit(directory, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	if err != nil {
		return application.GitState{}, errGitInspection
	}
	result := application.GitState{Paths: []domain.Text{}}
	for path := range strings.SplitSeq(list, "\x00") {
		if path != "" {
			result.Paths = append(result.Paths, domain.FromString(path))
		}
	}
	head, err := runSourceGit(directory, "rev-parse", "--verify", "--quiet", "HEAD")
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 1 {
			return result, nil
		}
		return application.GitState{}, errGitInspection
	}
	head = trimGitText(head)
	result.Head = &head
	return result, nil
}

func runSourceGit(directory string, args ...string) (string, error) {
	const outputLimit = 4 << 20
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-c", "core.fsmonitor=false", "-C", directory}, args...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		err := unix.Kill(-cmd.Process.Pid, unix.SIGKILL)
		if err == unix.ESRCH {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.WaitDelay = 100 * time.Millisecond
	var stdout bytes.Buffer
	var remaining atomic.Int64
	remaining.Store(outputLimit)
	cmd.Stdout = &gitOutput{remaining: &remaining, buffer: &stdout, cancel: cancel}
	cmd.Stderr = &gitOutput{remaining: &remaining, cancel: cancel}
	err := cmd.Run()
	if errors.Is(err, exec.ErrWaitDelay) {
		_ = cmd.Cancel()
	}
	if ctx.Err() != nil {
		return "", errGitInspection
	}
	if err != nil {
		return "", err
	}
	return decodeNodeUTF8(stdout.Bytes()), nil
}

type gitOutput struct {
	remaining *atomic.Int64
	buffer    *bytes.Buffer
	cancel    context.CancelFunc
}

func (output *gitOutput) Write(p []byte) (int, error) {
	if output.remaining.Add(-int64(len(p))) < 0 {
		output.cancel()
		return 0, errGitInspection
	}
	if output.buffer != nil {
		return output.buffer.Write(p)
	}
	return len(p), nil
}

func decodeNodeUTF8(raw []byte) string {
	text, _ := unicode.UTF8.NewDecoder().String(string(raw))
	return text
}

func trimGitText(text string) string {
	return strings.TrimFunc(text, func(r rune) bool {
		switch r {
		case ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
			return true
		}
		return r >= 9 && r <= 13 || r >= 0x2000 && r <= 0x200a
	})
}
