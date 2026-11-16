package computeprocess

import (
	"ariadne/runtime/internal/code/adapters/computewire"
	"ariadne/runtime/internal/code/domain"
	process "ariadne/runtime/internal/platform/computeprocess"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

func actualRunner(t *testing.T) *process.Runner {
	t.Helper()
	path := os.Getenv("ARIADNE_COMPUTE_TEST_BINARY")
	if path == "" {
		t.Skip("actual integration requires ARIADNE_COMPUTE_TEST_BINARY; CI sets compiled Rust path")
	}
	if !filepath.IsAbs(path) {
		t.Fatal("test binary must be absolute")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return process.New(process.Manifest{Path: path, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, Protocol: computewire.Protocol, Operation: computewire.Operation, SHA256: sha256.Sum256(raw)}, process.Identity{Protocol: computewire.Protocol, Operation: computewire.Operation})
}
func TestActualRustSharedFixturesAndMaximumGolden(t *testing.T) {
	r := actualRunner(t)
	counter := New(r)
	root := "../../../../../../contracts/compute/v1/fixtures"
	raw, err := os.ReadFile(filepath.Join(root, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Valid []struct{ Name, Request, Response string }
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, entry := range cases.Valid {
		t.Run(entry.Name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, entry.Request))
			if err != nil {
				t.Fatal(err)
			}
			request, err := computewire.DecodeRequest(raw)
			if err != nil {
				t.Fatal(err)
			}
			expectedRaw, err := os.ReadFile(filepath.Join(root, entry.Response))
			if err != nil {
				t.Fatal(err)
			}
			expected, err := computewire.DecodeResponse(expectedRaw, request)
			if err != nil {
				t.Fatal(err)
			}
			actual, err := counter.CountCoChanges(context.Background(), request.Input)
			if err != nil || !reflect.DeepEqual(actual, *expected.Counts) {
				t.Fatalf("actual Go→Rust differs: %v", err)
			}
		})
	}
	t.Run("maximum450000Pairs", func(t *testing.T) {
		input := domain.CoChangeInput{FileCount: 37500, Commits: make([][]uint32, 1500)}
		for i := range input.Commits {
			for j := range 25 {
				input.Commits[i] = append(input.Commits[i], uint32(i*25+j))
			}
		}
		want, err := domain.CountReference(input)
		if err != nil {
			t.Fatal(err)
		}
		start := time.Now()
		actual, err := counter.CountCoChanges(context.Background(), input)
		t.Logf("maximum full process+decode duration=%s", time.Since(start))
		if err != nil || !reflect.DeepEqual(actual, want) {
			t.Fatalf("maximum Go→Rust differs: %v pairs=%d", err, len(actual.Pairs))
		}
	})
}
func TestActualRustDomainErrorAndRawVersion(t *testing.T) {
	r := actualRunner(t)
	root := "../../../../../../contracts/compute/v1/fixtures"
	for _, entry := range []struct{ name, code string }{{"reject-request-out-of-range.json", "INVALID_INPUT"}, {"reject-request-bad-digest.json", "INVALID_INPUT"}, {"reject-request-wrong-version.json", "UNSUPPORTED_VERSION"}} {
		name := entry.name
		raw, err := os.ReadFile(filepath.Join(root, name))

		if err != nil {
			t.Fatal(err)
		}
		_, err = r.Run(context.Background(), raw, process.FrameLimits{Request: computewire.MaxRequestBytes, Response: computewire.MaxResponseBytes}, func(_ context.Context, frame []byte) error {
			var value map[string]any
			if err := json.Unmarshal(frame, &value); err != nil {
				return err
			}
			if value["status"] != "error" || value["protocol"] != computewire.Protocol || value["operation"] != computewire.Operation || value["code"] != entry.code {
				t.Errorf("unexpected error frame %v", value)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("raw %s: %v", name, err)
		}
	}
}

func TestActualRustCancellationAndValidationCancellation(t *testing.T) {
	input := domain.CoChangeInput{FileCount: 37500, Commits: make([][]uint32, 1500)}
	for i := range input.Commits {
		for j := range 25 {
			input.Commits[i] = append(input.Commits[i], uint32(i*25+j))
		}
	}
	request, err := computewire.NewRequest("cancel", input)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := computewire.EncodeRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"deadline", "validation"} {
		t.Run(kind, func(t *testing.T) {
			r := actualRunner(t)
			var ctx context.Context
			var cancel context.CancelFunc
			var expire func()
			if kind == "deadline" {
				controlled := &validationDeadline{Context: context.Background(), done: make(chan struct{})}
				ctx = controlled
				expire = func() { close(controlled.done) }
				cancel = func() {}
			} else {
				ctx, cancel = context.WithCancel(context.Background())
				expire = cancel
			}
			defer cancel()
			d, err := r.Run(ctx, raw, process.FrameLimits{Request: computewire.MaxRequestBytes, Response: computewire.MaxResponseBytes}, func(ctx context.Context, frame []byte) error {
				// Trigger expiry only after the real engine's frame proves Start and I/O.
				expire()
				<-ctx.Done()
				_, err := computewire.DecodeResponseContext(ctx, frame, request)
				return err
			})
			want := process.DeadlineExceeded
			if kind == "validation" {
				want = process.Cancelled
			}
			if err != want || !d.CleanupConfirmed || d.PID == 0 {
				t.Fatalf("want %v got %v diagnostics=%+v", want, err, d)
			}
		})
	}
}

// The clock boundary is controlled; process creation, framing, kill and reap are real.
type validationDeadline struct {
	context.Context
	done chan struct{}
}

func (c *validationDeadline) Done() <-chan struct{} { return c.done }
func (c *validationDeadline) Err() error {
	select {
	case <-c.done:
		return context.DeadlineExceeded
	default:
		return nil
	}
}

func TestMain(m *testing.M) {
	if filepath.Base(os.Args[0]) != "counter-helper-residue" {
		os.Exit(m.Run())
	}
	var prefix [4]byte
	if _, err := io.ReadFull(os.Stdin, prefix[:]); err != nil {
		os.Exit(2)
	}
	raw := make([]byte, binary.BigEndian.Uint32(prefix[:]))
	if _, err := io.ReadFull(os.Stdin, raw); err != nil {
		os.Exit(2)
	}
	request, err := computewire.DecodeRequest(raw)
	if err != nil {
		os.Exit(2)
	}
	counts, err := domain.CountReference(request.Input)
	if err != nil {
		os.Exit(2)
	}
	raw, err = computewire.EncodeResponse(request, computewire.Response{Counts: &counts})
	if err != nil {
		os.Exit(2)
	}
	if err = os.WriteFile("owned-residue", nil, 0600); err != nil {
		os.Exit(2)
	}
	binary.BigEndian.PutUint32(prefix[:], uint32(len(raw)))
	_, _ = os.Stdout.Write(prefix[:])
	_, _ = os.Stdout.Write(raw)
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}
func TestCounterRetainsCleanupEvidenceAndCanonicalCancellation(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "counter-helper-residue")
	if err = os.WriteFile(path, raw, 0700); err != nil {
		t.Fatal(err)
	}
	runner := process.New(process.Manifest{Path: path, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, Protocol: computewire.Protocol, Operation: computewire.Operation, SHA256: sha256.Sum256(raw)}, process.Identity{Protocol: computewire.Protocol, Operation: computewire.Operation})
	counter := New(runner)
	_, err = counter.CountCoChanges(context.Background(), domain.CoChangeInput{})
	var failure *process.Failure
	if !errors.As(err, &failure) || !errors.Is(err, process.EngineFailed) || failure.Diagnostics.PID == 0 || failure.Diagnostics.Stage != "quarantined" || failure.Diagnostics.CleanupConfirmed {
		t.Fatalf("lost cleanup diagnostics: %v %#v", err, failure)
	}
	if _, err = os.Stat(filepath.Join(failure.Diagnostics.Cwd, "owned-residue")); err != nil {
		t.Fatalf("unconfirmed cwd removed: %v", err)
	}
	// Actual child exit was observed; only this helper's owned residue prevented removal.
	if err = os.Remove(filepath.Join(failure.Diagnostics.Cwd, "owned-residue")); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(failure.Diagnostics.Cwd); err != nil {
		t.Fatal(err)
	}
	_, err = counter.CountCoChanges(context.Background(), domain.CoChangeInput{})
	if !errors.Is(err, process.Unavailable) || !errors.As(err, &failure) {
		t.Fatalf("quarantine lost evidence: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = counter.CountCoChanges(ctx, domain.CoChangeInput{})
	if !errors.Is(err, process.Cancelled) || !errors.Is(err, context.Canceled) || err.Error() != "CANCELLED" {
		t.Fatalf("cancellation classification drift: %v", err)
	}
}
