package files

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"ariadne/runtime/internal/extensions/domain"
)

func packageFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	wasm := []byte{0, 'a', 's', 'm', 13, 0, 1, 0}
	hash := sha256.Sum256(wasm)
	m := domain.Manifest{SchemaVersion: 1, ExtensionID: "example/team-report", Version: "1.0.0", World: domain.World, ArtifactSHA256: hex.EncodeToString(hash[:]), SDKMajor: 1, Description: "Team report", RequestedCapabilities: []string{}, License: "UNLICENSED"}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{"manifest.json": data, "extension.wasm": wasm} {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestInspectIsBoundedStructuralCheckNotExecutionApproval(t *testing.T) {
	dir := packageFixture(t)
	got, err := Inspect(dir)
	if err != nil {
		t.Fatalf("valid package inspection: %v", err)
	}
	if got.Manifest.ExtensionID != "example/team-report" || got.ArtifactStatus != "component-header-only" || got.RuntimeQualified {
		t.Fatalf("inspection overstated or lost identity: %+v", got)
	}
}

func TestInspectRejectsUnsafeOrAlteredPackages(t *testing.T) {
	for _, name := range []string{"hash mismatch", "symlink", "unknown file", "oversized artifact", "noncomponent"} {
		t.Run(name, func(t *testing.T) {
			dir := packageFixture(t)
			file := filepath.Join(dir, "extension.wasm")
			switch name {
			case "hash mismatch":
				if err := os.WriteFile(file, []byte("not matching"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				outside := filepath.Join(t.TempDir(), "outside")
				if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(file); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, file); err != nil {
					t.Fatal(err)
				}
			case "unknown file":
				if err := os.WriteFile(filepath.Join(dir, "install.sh"), []byte("exit 0"), 0600); err != nil {
					t.Fatal(err)
				}
			case "oversized artifact":
				f, err := os.Create(file)
				if err != nil {
					t.Fatal(err)
				}
				if err = f.Truncate(domain.MaxArtifactBytes + 1); err != nil {
					t.Fatal(err)
				}
				if err = f.Close(); err != nil {
					t.Fatal(err)
				}
			case "noncomponent":
				if err := os.WriteFile(file, []byte{0, 'a', 's', 'm', 1, 0, 0, 0}, 0600); err != nil {
					t.Fatal(err)
				}
			}
			_, err := Inspect(dir)
			if err == nil {
				t.Fatal("unsafe package accepted")
			}
			if strings.Contains(err.Error(), dir) {
				t.Fatal("internal path exposed")
			}
		})
	}
}

func TestInspectActuallyReadsOptionalUTF8(t *testing.T) {
	dir := packageFixture(t)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte{0xff}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Inspect(dir); err == nil {
		t.Fatal("invalid optional UTF-8 accepted")
	}
}

func TestPackageReaderRejectsFIFOExecutableAndOversizedOptional(t *testing.T) {
	for _, kind := range []string{"fifo", "executable", "optional-limit", "total-limit"} {
		t.Run(kind, func(t *testing.T) {
			dir := packageFixture(t)
			file := filepath.Join(dir, "README.md")
			switch kind {
			case "fifo":
				if err := syscall.Mkfifo(file, 0600); err != nil {
					t.Fatal(err)
				}
			case "executable":
				if err := os.WriteFile(file, []byte("hello"), 0700); err != nil {
					t.Fatal(err)
				}
			case "optional-limit":
				f, err := os.Create(file)
				if err != nil {
					t.Fatal(err)
				}
				err = f.Truncate(domain.MaxPackageBytes + 1)
				f.Close()
				if err != nil {
					t.Fatal(err)
				}
			case "total-limit":
				for _, name := range []string{"README.md", "LICENSE"} {
					f, err := os.Create(filepath.Join(dir, name))
					if err != nil {
						t.Fatal(err)
					}
					err = f.Truncate(domain.MaxPackageBytes / 2)
					f.Close()
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := (Reader{}).ReadPackage(dir); err == nil {
				t.Fatal("unsafe package accepted")
			}
		})
	}
}
func TestReadDetectsDescriptorAndPathChanges(t *testing.T) {
	for _, kind := range []string{"replace", "grow", "chmod"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "README.md")
			if err := os.WriteFile(path, []byte("before"), 0600); err != nil {
				t.Fatal(err)
			}
			root, err := os.OpenRoot(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			_, err = readFileObserved(root, "README.md", 100, func() {
				switch kind {
				case "replace":
					if e := os.Remove(path); e != nil {
						t.Fatal(e)
					}
					if e := os.WriteFile(path, []byte("after"), 0600); e != nil {
						t.Fatal(e)
					}
				case "grow":
					if e := os.WriteFile(path, []byte("longer changed"), 0600); e != nil {
						t.Fatal(e)
					}
				case "chmod":
					if e := os.Chmod(path, 0700); e != nil {
						t.Fatal(e)
					}
				}
			})
			if !errors.Is(err, domain.PackageChanged) {
				t.Fatalf("want PACKAGE_CHANGED, got %v", err)
			}
		})
	}
}
