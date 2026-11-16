package computeprocess

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	mode := strings.TrimPrefix(filepath.Base(os.Args[0]), "compute-helper-")
	if mode == filepath.Base(os.Args[0]) {
		os.Exit(m.Run())
	}
	if mode == "no-consume" {
		time.Sleep(time.Minute)
		os.Exit(5)
	}
	_, err := readFrame(os.Stdin, 16<<20)
	if err != nil {
		os.Exit(2)
	}
	if mode == "slow" {
		time.Sleep(time.Second * 5)
	}
	if mode == "stderr" {
		_, _ = os.Stderr.Write(bytes.Repeat([]byte("x"), 128<<10))
	}
	if mode == "isolation" {
		entries, err := os.ReadDir(".")
		if err != nil || len(entries) != 0 || len(os.Environ()) != 0 {
			os.Exit(4)
		}
	}
	switch mode {
	case "partial":
		_, _ = os.Stdout.Write([]byte{0, 0})
		os.Exit(0)
	case "truncated":
		_, _ = os.Stdout.Write([]byte{0, 0, 0, 5, 'x'})
		os.Exit(0)
	case "oversized":
		var prefix [4]byte
		binary.BigEndian.PutUint32(prefix[:], 33<<20)
		_, _ = os.Stdout.Write(prefix[:])
		os.Exit(0)
	default:
		_ = writeFrame(os.Stdout, []byte("ok"))
	}
	if mode == "extra" {
		_ = writeFrame(os.Stdout, []byte("again"))
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	if mode == "nonzero" {
		os.Exit(3)
	}
	os.Exit(0)
}
func fixtureRunner(t *testing.T, mode string) *Runner {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "compute-helper-"+mode)
	if err = os.WriteFile(path, raw, 0700); err != nil {
		t.Fatal(err)
	}
	return New(Manifest{Path: path, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, Protocol: "test/1", Operation: "one/1", SHA256: sha256.Sum256(raw)}, Identity{"test/1", "one/1"})
}

var testLimits = FrameLimits{Request: 16 << 20, Response: 32 << 20}

func validateOK(_ context.Context, raw []byte) error {
	if string(raw) != "ok" {
		return ProtocolError
	}
	return nil
}
func assertGone(t *testing.T, d Diagnostics) {
	t.Helper()
	if !d.CleanupConfirmed || len(d.Outstanding) > 0 {
		t.Fatalf("cleanup unconfirmed: %+v", d)
	}
	if runtime.GOOS != "windows" && d.PID != 0 {
		p, _ := os.FindProcess(d.PID)
		if err := p.Signal(syscall.Signal(0)); err == nil {
			t.Fatalf("PID %d still alive", d.PID)
		}
	}
}
func TestActualProcessTransportFailuresAndIsolation(t *testing.T) {
	t.Setenv("ARIADNE_SECRET_SENTINEL", "must-not-inherit")
	for _, tt := range []struct {
		mode string
		want error
	}{{"good", nil}, {"isolation", nil}, {"stderr", nil}, {"partial", ProtocolError}, {"truncated", ProtocolError}, {"oversized", LimitExceeded}, {"extra", ProtocolError}, {"nonzero", EngineFailed}} {
		t.Run(tt.mode, func(t *testing.T) {
			r := fixtureRunner(t, tt.mode)
			d, err := r.Run(context.Background(), []byte("request"), testLimits, validateOK)
			if !errors.Is(err, tt.want) {
				t.Fatalf("want %v got %v", tt.want, err)
			}
			assertGone(t, d)
			if tt.mode == "stderr" && (len(d.Stderr) != 64<<10 || !d.StderrTruncated) {
				t.Fatalf("stderr not bounded/drained: %d %v", len(d.Stderr), d.StderrTruncated)
			}
		})
	}
}
func TestManifestNoPATHFallbackOrChangedBytes(t *testing.T) {
	for _, mode := range []string{"relative", "missing", "hash", "changed", "version", "os", "cpu"} {
		t.Run(mode, func(t *testing.T) {
			r := fixtureRunner(t, "good")
			want := error(Unavailable)
			switch mode {
			case "relative":
				r.manifest.Path = filepath.Base(r.manifest.Path)
				t.Setenv("PATH", filepath.Dir(r.manifest.Path))
			case "missing":
				_ = os.Remove(r.manifest.Path)
			case "hash":
				r.manifest.SHA256 = [32]byte{}
			case "changed":
				f, _ := os.OpenFile(r.manifest.Path, os.O_APPEND|os.O_WRONLY, 0)
				_, _ = f.Write([]byte("changed"))
				_ = f.Close()
			case "version":
				r.manifest.Protocol = "old"
				want = UnsupportedVersion
			case "os":
				r.manifest.GOOS = "other"
			case "cpu":
				r.manifest.GOARCH = "other"
			}
			d, err := r.Run(context.Background(), nil, testLimits, validateOK)
			if err != want || d.PID != 0 {
				t.Fatalf("want %v got %v pid=%d", want, err, d.PID)
			}
		})
	}
}
func TestBusyCancelAndValidationCancellationReap(t *testing.T) {
	for _, mode := range []string{"slow", "no-consume", "validation"} {
		t.Run(mode, func(t *testing.T) {
			helper := mode
			if mode == "validation" {
				helper = "good"
			}
			r := fixtureRunner(t, helper)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan Diagnostics, 1)
			fail := make(chan error, 1)
			started := make(chan struct{})
			validate := validateOK
			if mode == "validation" {
				validate = func(ctx context.Context, _ []byte) error { close(started); <-ctx.Done(); return ctx.Err() }
			}
			go func() {
				request := []byte("request")
				if mode == "no-consume" {
					request = make([]byte, 16<<20)
				}
				d, err := r.Run(ctx, request, testLimits, validate)
				done <- d
				fail <- err
			}()
			if mode == "validation" {
				<-started
			} else {
				deadline := time.Now().Add(time.Second)
				for {
					r.mu.Lock()
					busy := r.busy
					r.mu.Unlock()
					if busy {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("runner did not admit")
					}
					time.Sleep(time.Millisecond)
				}
			}
			_, err := r.Run(context.Background(), nil, testLimits, validateOK)
			if err != Busy {
				t.Fatalf("want BUSY got %v", err)
			}
			cancel()
			d := <-done
			if err = <-fail; err != Cancelled {
				t.Fatalf("want CANCELLED got %v", err)
			}
			assertGone(t, d)
		})
	}
}
func TestDeadlineKillsBlockedInputAndLateResponse(t *testing.T) {
	for _, mode := range []string{"no-consume", "slow"} {
		t.Run(mode, func(t *testing.T) {
			r := fixtureRunner(t, mode)
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			d, err := r.Run(ctx, make([]byte, 16<<20), testLimits, validateOK)
			if err != DeadlineExceeded {
				t.Fatalf("want deadline got %v", err)
			}
			assertGone(t, d)
		})
	}
}
func TestUnobservedWaitQuarantinesAndRetainsLateOwner(t *testing.T) {
	r := fixtureRunner(t, "good")
	release := make(chan struct{})
	late := make(chan struct{})
	r.wait = func(cmd *exec.Cmd) error { err := cmd.Wait(); <-release; close(late); return err }
	d, err := r.Run(context.Background(), nil, testLimits, validateOK)
	if err != EngineFailed || d.CleanupConfirmed || !strings.Contains(strings.Join(d.Outstanding, ","), "wait") {
		t.Fatalf("false cleanup confirmation: %v %+v", err, d)
	}
	_, err = r.Run(context.Background(), nil, testLimits, validateOK)
	if err != Unavailable {
		t.Fatalf("quarantined runner reused: %v", err)
	}
	close(release)
	<-late
	if _, err := os.Stat(d.Cwd); err != nil {
		t.Fatalf("unconfirmed cleanup lost cwd: %v", err)
	}
	if err := os.Remove(d.Cwd); err != nil {
		t.Fatal(err)
	}
}

func TestBusyDiagnosticsDoNotClaimUnconfirmedChildCleanup(t *testing.T) {
	r := fixtureRunner(t, "good")
	r.busy = true
	d, err := r.Run(context.Background(), nil, testLimits, validateOK)
	if err != Busy || !d.CleanupConfirmed || d.PID != 0 || len(d.Outstanding) != 0 {
		t.Fatalf("admission rejection incorrectly implies leaked child: %v %+v", err, d)
	}
}
