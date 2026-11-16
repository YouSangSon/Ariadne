package sqlite

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ariadne/runtime/internal/extensions/adapters/files"
	"ariadne/runtime/internal/extensions/domain"
)

var ctx = context.Background()

const testID = "example/team-report"

func fixture(t *testing.T, version string) domain.PackageSnapshot {
	t.Helper()
	wasm := []byte{0, 'a', 's', 'm', 13, 0, 1, 0}
	h := sha256.Sum256(wasm)
	m := domain.Manifest{SchemaVersion: 1, ExtensionID: testID, Version: version, World: domain.World, ArtifactSHA256: hex.EncodeToString(h[:]), SDKMajor: 1, Description: "Team report", RequestedCapabilities: []string{}, License: "UNLICENSED"}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	p, err := domain.CapturePackage(map[string][]byte{"manifest.json": b, "extension.wasm": wasm, "README.md": []byte("Hello\n")})
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func openStore(t *testing.T, dir string, create bool) *Store {
	t.Helper()
	s, err := Open(dir, create)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func install(t *testing.T, s *Store, p domain.PackageSnapshot) domain.RegistryView {
	t.Helper()
	v, err := s.Install(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func requireFault(t *testing.T, err, errorWant error) {
	t.Helper()
	if !errors.Is(err, errorWant) {
		t.Fatalf("want %v, got %v", errorWant, err)
	}
}

func TestLifecyclePreservesSelectionAndPreventsABA(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	p := fixture(t, "1.0.0")
	p2 := fixture(t, "2.0.0")
	v := install(t, s, p)
	if v.Revision != 1 || v.RuntimeQualified {
		t.Fatal(v)
	}
	v, err := s.Activate(ctx, testID, p.Digest(), v.Revision)
	if err != nil {
		t.Fatal(err)
	}
	activeRevision := v.Revision
	v = install(t, s, p2)
	if v.SelectedDigest != p.Digest() || !v.Enabled || v.Revision != activeRevision+1 {
		t.Fatal(v)
	}
	same := install(t, s, p2)
	if same.Revision != v.Revision || same.SelectedDigest != p.Digest() {
		t.Fatal(same)
	}
	_, err = s.Remove(ctx, testID, p.Digest(), v.Revision)
	requireFault(t, err, domain.ExtensionActive)
	v, err = s.Activate(ctx, testID, p2.Digest(), v.Revision)
	if err != nil {
		t.Fatal(err)
	}
	v, err = s.Activate(ctx, testID, p.Digest(), v.Revision)
	if err != nil {
		t.Fatal(err)
	}
	v, err = s.Disable(ctx, testID, v.Revision)
	if err != nil {
		t.Fatal(err)
	}
	old := v.Revision
	v, err = s.Remove(ctx, testID, p.Digest(), v.Revision)
	if err != nil || v.SelectedDigest != "" {
		t.Fatalf("%+v %v", v, err)
	}
	v, err = s.Remove(ctx, testID, p2.Digest(), v.Revision)
	if err != nil || len(v.Packages) != 0 {
		t.Fatalf("%+v %v", v, err)
	}
	v = install(t, s, p)
	if v.Revision <= old {
		t.Fatal("tombstone revision reused")
	}
	_, err = s.Activate(ctx, testID, p.Digest(), old)
	requireFault(t, err, domain.RevisionConflict)
}
func TestCapturedPackageSurvivesSourceChanges(t *testing.T) {
	source := t.TempDir()
	p := fixture(t, "1.0.0")
	for n, b := range p.Files() {
		if err := os.WriteFile(filepath.Join(source, n), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	captured, err := (files.Reader{}).ReadPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source, "README.md"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	s := openStore(t, t.TempDir(), true)
	install(t, s, captured)
	if err = s.verifyArtifact(p); err != nil {
		t.Fatal("installed bytes differ from captured bytes", err)
	}
	if err = os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Inspect(ctx, testID); err != nil {
		t.Fatal(err)
	}
}
func TestIndependentConnectionsCASExactlyOneWins(t *testing.T) {
	dir := t.TempDir()
	s := openStore(t, dir, true)
	p := fixture(t, "1.0.0")
	v := install(t, s, p)
	other := openStore(t, dir, false)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, store := range []*Store{s, other} {
		go func(store *Store) {
			<-start
			_, err := store.Activate(ctx, testID, p.Digest(), v.Revision)
			results <- err
		}(store)
	}
	close(start)
	wins := 0
	conflicts := 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			wins++
		} else if errors.Is(err, domain.RevisionConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("wins %d conflicts %d", wins, conflicts)
	}
}
func TestRemovalFailureIsDurableAndResumable(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	p := fixture(t, "1.0.0")
	v := install(t, s, p)
	extra := filepath.Join(s.root, "artifacts", p.Digest(), "unknown.txt")
	if err := os.WriteFile(extra, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	v, err := s.Remove(ctx, testID, p.Digest(), v.Revision)
	requireFault(t, err, domain.CleanupPending)
	if !v.CleanupPending {
		t.Fatal(v)
	}
	_, err = s.Activate(ctx, testID, p.Digest(), v.Revision)
	requireFault(t, err, domain.RemovalPending)
	_, err = s.Install(ctx, p)
	requireFault(t, err, domain.RemovalPending)
	if err = os.Remove(extra); err != nil {
		t.Fatal(err)
	}
	v, err = s.Remove(ctx, testID, p.Digest(), v.Revision)
	if err != nil || len(v.Packages) != 0 || v.CleanupPending {
		t.Fatalf("%+v %v", v, err)
	}
}
func TestAlreadyOpenStoreRejectsFutureSchemaOnEveryOperation(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	p := fixture(t, "1.0.0")
	v := install(t, s, p)
	if _, err := s.db.Exec("UPDATE registry_meta SET schema_version=2"); err != nil {
		t.Fatal(err)
	}
	checks := []func() error{
		func() error { _, e := s.Inspect(ctx, testID); return e }, func() error { _, e := s.Install(ctx, p); return e }, func() error { _, e := s.Activate(ctx, testID, p.Digest(), v.Revision); return e }, func() error { _, e := s.Disable(ctx, testID, v.Revision); return e }, func() error { _, e := s.Remove(ctx, testID, p.Digest(), v.Revision); return e },
	}
	for _, check := range checks {
		requireFault(t, check(), domain.UnsupportedSchema)
	}
	_, err := Open(s.workspace, false)
	requireFault(t, err, domain.UnsupportedSchema)
	var revision int64
	if err = s.db.QueryRow("SELECT revision FROM extension_heads").Scan(&revision); err != nil || revision != v.Revision {
		t.Fatal(revision, err)
	}
}
func TestRegistryTrustFailuresPreserveData(t *testing.T) {
	for _, kind := range []string{"private-mode", "db-mode", "sidecar-link", "artifact-link", "root-link", "copy", "owner-binding", "empty", "corrupt", "schema"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			s := openStore(t, dir, true)
			p := fixture(t, "1.0.0")
			install(t, s, p)
			s.Close()
			want := domain.RegistryUntrusted
			switch kind {
			case "private-mode":
				os.Chmod(filepath.Join(dir, ".ariadne", "private"), 0755)
			case "db-mode":
				os.Chmod(filepath.Join(s.root, "registry.sqlite"), 0644)
			case "sidecar-link":
				os.Symlink(filepath.Join(s.root, "registry.sqlite"), filepath.Join(s.root, "registry.sqlite-journal"))
			case "artifact-link":
				os.Rename(filepath.Join(s.root, "artifacts"), filepath.Join(s.root, "original"))
				os.Symlink(filepath.Join(s.root, "original"), filepath.Join(s.root, "artifacts"))
			case "root-link":
				os.Rename(filepath.Join(dir, ".ariadne"), filepath.Join(dir, "original"))
				os.Symlink(filepath.Join(dir, "original"), filepath.Join(dir, ".ariadne"))
			case "copy":
				target := t.TempDir()
				err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, walkErr error) error {
					if walkErr != nil {
						return walkErr
					}
					rel, e := filepath.Rel(dir, path)
					if e != nil {
						return e
					}
					if rel == "." {
						return nil
					}
					dst := filepath.Join(target, rel)
					if entry.IsDir() {
						return os.Mkdir(dst, 0700)
					}
					b, e := os.ReadFile(path)
					if e != nil {
						return e
					}
					return os.WriteFile(dst, b, 0600)
				})
				if err != nil {
					t.Fatal(err)
				}
				dir = target
				want = domain.WorkspaceMismatch
			case "owner-binding", "schema":
				re := openStore(t, dir, false)
				query := "UPDATE registry_meta SET owner_uid=owner_uid+1"
				want = domain.WorkspaceMismatch
				if kind == "schema" {
					query = "UPDATE registry_meta SET schema_version=2"
					want = domain.UnsupportedSchema
				}
				if _, err := re.db.Exec(query); err != nil {
					t.Fatal(err)
				}
				re.Close()
			case "empty", "corrupt":
				content := []byte{}
				if kind == "corrupt" {
					content = []byte("not sqlite")
				}
				if err := os.WriteFile(filepath.Join(s.root, "registry.sqlite"), content, 0600); err != nil {
					t.Fatal(err)
				}
				want = domain.RegistryCorrupt
			}
			opened, err := Open(dir, true)
			if opened != nil {
				opened.Close()
			}
			requireFault(t, err, want)
		})
	}
}
func TestOrphanReuseRejectsCorruption(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	p := fixture(t, "1.0.0")
	if err := s.publish(p); err != nil {
		t.Fatal(err)
	}
	install(t, s, p)
	file := filepath.Join(s.root, "artifacts", p.Digest(), "README.md")
	if err := os.WriteFile(file, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := s.Install(ctx, p)
	requireFault(t, err, domain.RegistryCorrupt)
	b, _ := os.ReadFile(file)
	if string(b) != "corrupt" {
		t.Fatal("corruption overwritten")
	}
}
func TestSubprocessHelper(t *testing.T) {
	if os.Getenv("ARIADNE_TEST_HELPER") != "1" {
		return
	}
	s, err := Open(os.Getenv("ARIADNE_TEST_WORKSPACE"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	p := fixture(t, "2.0.0")
	stage := os.Getenv("ARIADNE_TEST_STAGE")
	if stage == "cas" {
		_, err = s.Activate(ctx, testID, fixture(t, "1.0.0").Digest(), 1)
		if errors.Is(err, domain.RevisionConflict) {
			os.Exit(71)
		}
		if err != nil {
			t.Fatal(err)
		}
		return
	}
	s.hook = func(point string) {
		if point == stage {
			os.Exit(70)
		}
	}
	if stage == "removing" || stage == "deleted-file" {
		v, e := s.Inspect(ctx, testID)
		if e != nil {
			t.Fatal(e)
		}
		_, err = s.Remove(ctx, testID, fixture(t, "1.0.0").Digest(), v.Revision)
	} else {
		_, err = s.Install(ctx, p)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Fatal("crash hook not reached")
}
func helper(t *testing.T, dir, stage string) (int, string) {
	t.Helper()
	deadline, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(deadline, os.Args[0], "-test.run=^TestSubprocessHelper$")
	cmd.Env = append(os.Environ(), "ARIADNE_TEST_HELPER=1", "ARIADNE_TEST_WORKSPACE="+dir, "ARIADNE_TEST_STAGE="+stage)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return 0, string(output)
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode(), string(output)
	}
	t.Fatal(err)
	return -1, string(output)
}
func TestSubprocessCrashBoundaries(t *testing.T) {
	for _, stage := range []string{"staged", "published", "removing", "deleted-file"} {
		t.Run(stage, func(t *testing.T) {
			dir := t.TempDir()
			s := openStore(t, dir, true)
			p := fixture(t, "1.0.0")
			install(t, s, p)
			s.Close()
			code, out := helper(t, dir, stage)
			if code != 70 {
				t.Fatalf("exit %d %s", code, out)
			}
			s = openStore(t, dir, false)
			v, err := s.Inspect(ctx, testID)
			if err != nil {
				t.Fatal(err)
			}
			if stage == "staged" || stage == "published" {
				if len(v.Packages) != 1 || v.Revision != 1 {
					t.Fatal(v)
				}
				if stage == "staged" && len(v.StagingEntries) != 1 {
					t.Fatal(v)
				}
				if stage == "published" && len(v.OrphanArtifacts) != 1 {
					t.Fatal(v)
				}
				install(t, s, fixture(t, "2.0.0"))
			} else {
				if !v.CleanupPending || v.Revision != 2 {
					t.Fatal(v)
				}
				v, err = s.Remove(ctx, testID, p.Digest(), v.Revision)
				if err != nil || len(v.Packages) != 0 {
					t.Fatalf("%+v %v", v, err)
				}
			}
		})
	}
}
func TestSubprocessCASExactlyOneWins(t *testing.T) {
	dir := t.TempDir()
	s := openStore(t, dir, true)
	install(t, s, fixture(t, "1.0.0"))
	s.Close()
	var wg sync.WaitGroup
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, out := helper(t, dir, "cas")
			if code != 0 && code != 71 {
				t.Error(code, out)
			}
			results <- code
		}()
	}
	wg.Wait()
	close(results)
	sum := 0
	for n := range results {
		sum += n
	}
	if sum != 71 {
		t.Fatal("expected one CAS winner", sum)
	}
}
func TestRemoveActivateInstallRaceCannotDeleteActivePackage(t *testing.T) {
	dir := t.TempDir()
	a := openStore(t, dir, true)
	p := fixture(t, "1.0.0")
	install(t, a, p)
	b := openStore(t, dir, false)
	c := openStore(t, dir, false)
	start := make(chan struct{})
	result := make(chan error, 3)
	go func() { <-start; _, e := a.Remove(ctx, testID, p.Digest(), 1); result <- e }()
	go func() { <-start; _, e := b.Activate(ctx, testID, p.Digest(), 1); result <- e }()
	go func() { <-start; _, e := c.Install(ctx, p); result <- e }()
	close(start)
	for i := 0; i < 3; i++ {
		e := <-result
		if e != nil && !errors.Is(e, domain.RevisionConflict) && !errors.Is(e, domain.ExtensionActive) && !errors.Is(e, domain.RemovalPending) && !errors.Is(e, domain.NotInstalled) {
			t.Fatal(e)
		}
	}
	v, e := a.Inspect(ctx, testID)
	if e != nil {
		t.Fatal(e)
	}
	if v.Enabled {
		if err := a.verifyArtifact(p); err != nil {
			t.Fatal("active artifact deleted", err)
		}
	}
}
func TestMissingRegistryInspectionCreatesNothing(t *testing.T) {
	dir := t.TempDir()
	s := openStore(t, dir, false)
	_, err := s.Inspect(ctx, testID)
	requireFault(t, err, domain.NotInstalled)
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatal(entries, err)
	}
}
func TestErrorsNeverExposeSQLiteOrPaths(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	s.db.Close()
	_, err := s.Inspect(ctx, testID)
	if err == nil || strings.Contains(err.Error(), s.root) || strings.Contains(strings.ToLower(err.Error()), "sql") {
		t.Fatal(err)
	}
}

func TestFirstInstallPublishCrashReportsOrphanWithoutRegistration(t *testing.T) {
	dir := t.TempDir()
	s := openStore(t, dir, true)
	s.Close()
	code, out := helper(t, dir, "published")
	if code != 70 {
		t.Fatal(code, out)
	}
	s = openStore(t, dir, false)
	v, err := s.Inspect(ctx, testID)
	if err != nil || v.Revision != 0 || len(v.Packages) != 0 || len(v.OrphanArtifacts) != 1 || v.RuntimeQualified {
		t.Fatalf("%+v %v", v, err)
	}
	_, err = s.Activate(ctx, testID, fixture(t, "2.0.0").Digest(), 0)
	requireFault(t, err, domain.NotInstalled)
	install(t, s, fixture(t, "2.0.0"))
}
func TestBusyWriterReturnsBoundedError(t *testing.T) {
	dir := t.TempDir()
	s := openStore(t, dir, true)
	p := fixture(t, "1.0.0")
	install(t, s, p)
	other := openStore(t, dir, false)
	tx, err := s.begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	_, err = other.Disable(ctx, testID, 1)
	requireFault(t, err, domain.RegistryBusy)
}
func TestCancellationDoesNotUnlockFilesystemTransition(t *testing.T) {
	for _, point := range []string{"published", "deleted-file"} {
		t.Run(point, func(t *testing.T) {
			dir := t.TempDir()
			s := openStore(t, dir, true)
			p := fixture(t, "1.0.0")
			if point == "deleted-file" {
				install(t, s, p)
			}
			other := openStore(t, dir, false)
			cancelled, cancel := context.WithCancel(context.Background())
			defer cancel()
			fired := false
			s.hook = func(observed string) {
				if !fired && observed == point {
					fired = true
					cancel()
					_, err := other.Inspect(ctx, testID)
					requireFault(t, err, domain.RegistryBusy)
				}
			}
			var v domain.RegistryView
			var err error
			if point == "published" {
				v, err = s.Install(cancelled, p)
			} else {
				v, err = s.Remove(cancelled, testID, p.Digest(), 1)
			}
			if !fired || err != nil {
				t.Fatalf("hook %v view %+v error %v", fired, v, err)
			}
			if point == "published" {
				if v.Revision != 1 {
					t.Fatal(v)
				}
				if err = s.verifyArtifact(p); err != nil {
					t.Fatal(err)
				}
			} else if len(v.Packages) != 0 || v.Revision != 2 {
				t.Fatal(v)
			}
		})
	}
}
func TestWorkspaceURLReservedCharacters(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workspace ?#%")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	s := openStore(t, dir, true)
	install(t, s, fixture(t, "1.0.0"))
}
func TestRemovingOneDigestPreservesOtherHeadRevisions(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	p := fixture(t, "1.0.0")
	p2 := fixture(t, "2.0.0")
	install(t, s, p)
	v := install(t, s, p2)
	s.hook = func(point string) {
		if point == "removing" {
			s.hook = nil
			_, err := s.Activate(ctx, testID, p2.Digest(), v.Revision+1)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	got, err := s.Remove(ctx, testID, p.Digest(), v.Revision)
	if err != nil || got.Revision != v.Revision+2 || got.SelectedDigest != p2.Digest() || !got.Enabled {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestRejectWritableWorkspaceAndAncestorBeforeCreatingRegistry(t *testing.T) {
	for _, kind := range []string{"workspace", "ancestor"} {
		t.Run(kind, func(t *testing.T) {
			parent := t.TempDir()
			workspace := filepath.Join(parent, "checkout")
			if err := os.Mkdir(workspace, 0700); err != nil {
				t.Fatal(err)
			}
			change := workspace
			if kind == "ancestor" {
				change = parent
			}
			if err := os.Chmod(change, 0777); err != nil {
				t.Fatal(err)
			}
			s, err := Open(workspace, true)
			if s != nil {
				s.Close()
			}
			requireFault(t, err, domain.RegistryUntrusted)
			if _, err = os.Lstat(filepath.Join(workspace, ".ariadne")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("untrusted ancestry created registry", err)
			}
		})
	}
}
func TestOpenedStoreRechecksWritableAncestryBeforeMutation(t *testing.T) {
	parent := t.TempDir()
	workspace := filepath.Join(parent, "checkout")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	s := openStore(t, workspace, true)
	p := fixture(t, "1.0.0")
	v := install(t, s, p)
	if err := os.Chmod(parent, 0777); err != nil {
		t.Fatal(err)
	}
	_, err := s.Remove(ctx, testID, p.Digest(), v.Revision)
	requireFault(t, err, domain.RegistryUntrusted)
	var revision int64
	if err = s.db.QueryRow("SELECT revision FROM extension_heads WHERE id=?", testID).Scan(&revision); err != nil || revision != v.Revision {
		t.Fatal("untrusted mutation changed revision", revision, err)
	}
	if err = s.verifyArtifact(p); err != nil {
		t.Fatal("untrusted mutation changed artifact", err)
	}
}
func TestAcceptTrustedStickyAncestor(t *testing.T) {
	parent := t.TempDir()
	if err := os.Chmod(parent, os.ModeSticky|0777); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(parent, "checkout")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	s := openStore(t, workspace, true)
	install(t, s, fixture(t, "1.0.0"))
}

func TestCooperatingWriterMayRemoveObservedJournal(t *testing.T) {
	s := openStore(t, t.TempDir(), true)
	install(t, s, fixture(t, "1.0.0"))
	journal := filepath.Join(s.root, "registry.sqlite-journal")
	if err := os.WriteFile(journal, nil, 0600); err != nil {
		t.Fatal(err)
	}
	observed := false
	s.hook = func(point string) {
		if point == "sidecar-observed" {
			observed = true
			if err := os.Remove(journal); err != nil {
				t.Fatal(err)
			}
		}
	}
	v, err := s.Inspect(ctx, testID)
	if !observed || err != nil || v.Revision != 1 {
		t.Fatalf("valid disappearing sidecar rejected: observed %v view %+v error %v", observed, v, err)
	}
}
