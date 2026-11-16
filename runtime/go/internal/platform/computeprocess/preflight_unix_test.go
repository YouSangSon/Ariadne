//go:build unix

package computeprocess

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

type cancelHashContext struct {
	context.Context
	checks int
}

func (c *cancelHashContext) Err() error {
	c.checks--
	if c.checks <= 0 {
		return context.Canceled
	}
	return nil
}
func TestIdentityHashHonorsCancellationAndNeverSpawnsPrecancelled(t *testing.T) {
	r := fixtureRunner(t, "good")
	ctx := &cancelHashContext{Context: context.Background(), checks: 4}
	if err := r.installed(ctx); err != Cancelled {
		t.Fatalf("hash checkpoint lost cancellation: %v", err)
	}
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	d, err := r.Run(parent, []byte("request"), testLimits, validateOK)
	if err != Cancelled || d.PID != 0 {
		t.Fatalf("cancelled preflight spawned: %v %+v", err, d)
	}
}
func TestIdentityRejectsFIFOAndSymlinkBeforeOpen(t *testing.T) {
	r := fixtureRunner(t, "good")
	path := filepath.Join(t.TempDir(), "fifo")
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	r.manifest.Path = path
	if err := r.installed(context.Background()); err != Unavailable {
		t.Fatalf("FIFO accepted: %v", err)
	}
	target := fixtureRunner(t, "good")
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(target.manifest.Path, link); err != nil {
		t.Fatal(err)
	}
	target.manifest.Path = link
	if err := target.installed(context.Background()); err != Unavailable {
		t.Fatalf("symlink accepted: %v", err)
	}
}
