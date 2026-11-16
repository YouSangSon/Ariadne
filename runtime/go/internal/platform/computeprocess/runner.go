package computeprocess

import (
	"context"
	"crypto/sha256"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

type Manifest struct {
	Path, GOOS, GOARCH, Protocol, Operation string
	SHA256                                  [32]byte
}
type Identity struct{ Protocol, Operation string }
type Diagnostics struct {
	Cwd                               string
	PID                               int
	Stage                             string
	Outstanding                       []string
	Stderr                            []byte
	StderrTruncated, CleanupConfirmed bool
}

// Runner owns one slot and no queue. Composition must share this pointer.
type Runner struct {
	quarantineDiagnostics Diagnostics
	manifest              Manifest
	expected              Identity
	mu                    sync.Mutex
	busy, quarantined     bool
	wait                  func(*exec.Cmd) error
}

func New(manifest Manifest, expected Identity) *Runner {
	return &Runner{manifest: manifest, expected: expected}
}
func (r *Runner) installed(ctx context.Context) error {
	if ctx.Err() != nil {
		return contextError(ctx)
	}
	m := r.manifest
	if m.Protocol != r.expected.Protocol || m.Operation != r.expected.Operation {
		return UnsupportedVersion
	}
	if !filepath.IsAbs(m.Path) || m.GOOS != runtime.GOOS || m.GOARCH != runtime.GOARCH {
		return Unavailable
	}
	info, err := os.Lstat(m.Path)
	if err != nil || !info.Mode().IsRegular() {
		return Unavailable
	}
	if ctx.Err() != nil {
		return contextError(ctx)
	}
	f, err := os.Open(m.Path)
	if err != nil {
		return Unavailable
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return Unavailable
	}
	h := sha256.New()
	buf := make([]byte, 32<<10)
	for {
		if ctx.Err() != nil {
			return contextError(ctx)
		}
		n, readErr := f.Read(buf)
		if n > 0 {
			_, _ = h.Write(buf[:n])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return Unavailable
		}
	}
	if ctx.Err() != nil {
		return contextError(ctx)
	}
	var digest [32]byte
	copy(digest[:], h.Sum(nil))
	if digest != m.SHA256 {
		return Unavailable
	}
	return nil
}
func contextError(ctx context.Context) error {
	if ctx.Err() == context.DeadlineExceeded {
		return DeadlineExceeded
	}
	return Cancelled
}
func (r *Runner) Run(parent context.Context, request []byte, limits FrameLimits, validate func(context.Context, []byte) error) (d Diagnostics, result error) {
	d.CleanupConfirmed = true
	r.mu.Lock()
	if r.quarantined {
		d = r.quarantineDiagnostics
		r.mu.Unlock()
		return d, Unavailable
	}
	if r.busy {
		r.mu.Unlock()
		return d, Busy
	}
	r.busy = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.busy = false
		if !d.CleanupConfirmed {
			r.quarantined = true
			r.quarantineDiagnostics = d
		}
		r.mu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	if ctx.Err() != nil {
		return d, contextError(ctx)
	}
	if limits.Request == 0 || limits.Response == 0 || limits.Request > 16<<20 || limits.Response > 32<<20 || validate == nil {
		return d, InvalidInput
	}
	if len(request) > int(limits.Request) {
		return d, LimitExceeded
	}
	if err := r.installed(ctx); err != nil {
		return d, err
	}
	cwd, err := os.MkdirTemp("", "ariadne-compute-cwd-")
	if err != nil {
		return d, Unavailable
	}
	d.Cwd = cwd
	defer func() {
		if !d.CleanupConfirmed {
			d.Outstanding = append(d.Outstanding, "cwd")
			d.Stage = "quarantined"
			return
		}
		if err := os.Remove(cwd); err != nil {
			d.CleanupConfirmed = false
			d.Stage = "quarantined"
			d.Outstanding = append(d.Outstanding, "cwd")
			if result == nil {
				result = EngineFailed
			}
		}
	}()
	// Explicit non-nil environment: no HOME, workspace, PATH, API or DB settings.
	env := []string{}
	if runtime.GOOS == "windows" {
		env = append(env, "SystemRoot="+os.Getenv("SystemRoot"))
	}
	cmd := exec.Command(r.manifest.Path)
	cmd.Dir = cwd
	cmd.Env = env
	var pipes []*os.File
	closePipes := func() {
		for _, p := range pipes {
			_ = p.Close()
		}
	}
	defer closePipes()
	inChild, in, err := os.Pipe()
	if err != nil {
		return d, Unavailable
	}
	pipes = append(pipes, inChild, in)
	out, outChild, err := os.Pipe()
	if err != nil {
		return d, Unavailable
	}
	pipes = append(pipes, out, outChild)
	stderr, errChild, err := os.Pipe()
	if err != nil {
		return d, Unavailable
	}
	pipes = append(pipes, stderr, errChild)
	cmd.Stdin = inChild
	cmd.Stdout = outChild
	cmd.Stderr = errChild
	// Recheck installed bytes immediately before Start; trusted installation is not a sandbox.
	if err = r.installed(ctx); err != nil {
		return d, err
	}
	if ctx.Err() != nil {
		return d, contextError(ctx)
	}
	if err = cmd.Start(); err != nil {
		return d, Unavailable
	}
	_ = inChild.Close()
	_ = outChild.Close()
	_ = errChild.Close()
	d.PID = cmd.Process.Pid
	d.CleanupConfirmed = false
	d.Stage = "running"
	var abortOnce sync.Once
	abort := func() {
		abortOnce.Do(func() { _ = in.Close(); _ = out.Close(); _ = stderr.Close(); _ = cmd.Process.Kill() })
	}
	watcherDone := make(chan struct{})
	watcherStop := make(chan struct{})
	go func(watch context.Context) {
		defer close(watcherDone)
		select {
		case <-watch.Done():
			abort()
		case <-watcherStop:
		}
	}(ctx)
	type frameResult struct {
		raw []byte
		err error
	}
	first := make(chan frameResult, 1)
	readDone := make(chan error, 1)
	writeDone := make(chan error, 1)
	type stderrResult struct {
		raw       []byte
		truncated bool
		err       error
	}
	stderrDone := make(chan stderrResult, 1)
	waitDone := make(chan error, 1)
	go func() { writeDone <- writeFrame(in, request) }()
	go func() {
		raw, err := readFrame(out, limits.Response)
		first <- frameResult{raw, err}
		if err != nil {
			readDone <- err
			return
		}
		var tail [1]byte
		n, err := out.Read(tail[:])
		if n != 0 || err != io.EOF {
			readDone <- ProtocolError
		} else {
			readDone <- nil
		}
	}()
	go func() {
		var raw []byte
		truncated := false
		buf := make([]byte, 8192)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				keep := min(n, (64<<10)-len(raw))
				raw = append(raw, buf[:keep]...)
				truncated = truncated || keep < n
			}
			if err != nil {
				if err == io.EOF {
					err = nil
				}
				stderrDone <- stderrResult{raw, truncated, err}
				return
			}
		}
	}()
	// Exactly one owner calls Wait; manual pipes let it reap independently of validation.
	go func() {
		if r.wait != nil {
			waitDone <- r.wait(cmd)
		} else {
			waitDone <- cmd.Wait()
		}
	}()
	select {
	case f := <-first:
		result = f.err
		if result == nil {
			d.Stage = "validating"
			result = validate(ctx, f.raw)
		}
	case <-ctx.Done():
		result = contextError(ctx)
	}
	if ctx.Err() != nil {
		result = contextError(ctx)
	}
	if result != nil {
		abort()
	} else {
		_ = in.Close()
	}
	d.Stage = "cleanup"
	// Every I/O owner and the sole Wait must be observed, independently of the request deadline.
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	cancelled := ctx.Done()
	pending := map[string]bool{"writer": true, "stdout": true, "stderr": true, "wait": true}
	for len(pending) > 0 {
		select {
		case err := <-writeDone:
			delete(pending, "writer")
			writeDone = nil
			if err != nil && result == nil {
				result = EngineFailed
				abort()
			}
		case err := <-readDone:
			delete(pending, "stdout")
			readDone = nil
			if err != nil && result == nil {
				result = err
				abort()
			}
		case value := <-stderrDone:
			delete(pending, "stderr")
			stderrDone = nil
			d.Stderr = value.raw
			d.StderrTruncated = value.truncated
			if value.err != nil && result == nil {
				result = EngineFailed
				abort()
			}
		case err := <-waitDone:
			delete(pending, "wait")
			waitDone = nil
			if err != nil && result == nil {
				result = EngineFailed
				abort()
			}
		case <-cancelled:
			if result == nil {
				result = contextError(ctx)
			}
			abort()
			cancelled = nil
		case <-timer.C:
			abort()
			for _, name := range []string{"writer", "stdout", "stderr", "wait"} {
				if pending[name] {
					d.Outstanding = append(d.Outstanding, name)
				}
			}
			result = EngineFailed
			goto finished
		}
	}
	d.CleanupConfirmed = true
finished:
	close(watcherStop)
	<-watcherDone
	if ctx.Err() != nil {
		result = contextError(ctx)
	}
	if parent.Err() != nil {
		result = contextError(parent)
	}
	d.Stage = "finished"
	if !d.CleanupConfirmed {
		d.Stage = "quarantined"
	}
	return d, result
}
