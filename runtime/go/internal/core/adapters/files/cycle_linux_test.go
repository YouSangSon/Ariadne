//go:build linux

package corefiles

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestRootCycleProcess(t *testing.T) {
	root := os.Getenv("ARIADNE_ROOT_CYCLE_CHILD")
	if root == "" {
		return
	}
	_, err := (Reader{}).ReadProjectText(root, "source.txt")
	if err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}
func TestDecodedRootCycleMatchesNodeInWaitedChildren(t *testing.T) {
	repository, err := filepath.Abs("../../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err = os.Mkdir(filepath.Join(root, "\xe2\x82"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "\xe2\x82/source.txt"), []byte("raw body"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink("\xe2\x82", filepath.Join(root, "a")); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink("a", filepath.Join(root, "�")); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	script := `import {readProjectText} from './core/infrastructure/project-files.mjs';readProjectText(process.argv[1],'source.txt')`
	commands := [][]string{{"node", "--input-type=module", "-e", script, filepath.Join(root, "a")}, {executable, "-test.run=^TestRootCycleProcess$"}}
	for i, args := range commands {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		command := exec.CommandContext(ctx, args[0], args[1:]...)
		command.Dir = repository
		command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		command.Env = append(os.Environ(), "ARIADNE_ROOT_CYCLE_CHILD="+filepath.Join(root, "a"))
		command.Cancel = func() error { return syscall.Kill(-command.Process.Pid, syscall.SIGKILL) }
		command.WaitDelay = time.Second
		out, runErr := command.CombinedOutput()
		timedOut := errors.Is(ctx.Err(), context.DeadlineExceeded)
		cancel()
		if !timedOut || runErr == nil {
			t.Fatalf("child%d expected observed Node decoded cycle: timeout=%v err=%v output=%q", i, timedOut, runErr, out)
		}
		if !errors.Is(syscall.Kill(-command.Process.Pid, 0), syscall.ESRCH) {
			t.Fatalf("child%d process group survived Wait", i)
		}
	}
}
