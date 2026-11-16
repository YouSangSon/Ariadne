package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
)

func snapshotFiles(t *testing.T) map[string][]byte {
	t.Helper()
	wasm := []byte{0, 'a', 's', 'm', 13, 0, 1, 0}
	h := sha256.Sum256(wasm)
	m := Manifest{SchemaVersion: 1, ExtensionID: "example/team-report", Version: "1.0.0", World: World, ArtifactSHA256: hex.EncodeToString(h[:]), SDKMajor: 1, Description: "Team report", RequestedCapabilities: []string{}, License: "UNLICENSED"}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return map[string][]byte{"manifest.json": b, "extension.wasm": wasm, "README.md": []byte("Hello\n")}
}
func TestPackageDigestIndependentPythonGolden(t *testing.T) {
	p, err := CapturePackage(snapshotFiles(t))
	if err != nil {
		t.Fatal(err)
	}
	const golden = "83b941f3f5fab578a83a1f41cb73692935360b16a4a9fd3390e0c39c557e94e8"
	if p.Digest() != golden {
		t.Fatalf("package digest %s, want %s", p.Digest(), golden)
	}
}
func TestSnapshotCanonicalManifestAndCapturedBytes(t *testing.T) {
	f := snapshotFiles(t)
	original, err := CapturePackage(f)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err = json.Unmarshal(f["manifest.json"], &raw); err != nil {
		t.Fatal(err)
	}
	f["manifest.json"], err = json.MarshalIndent(raw, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	reordered, err := CapturePackage(f)
	if err != nil || reordered.Digest() != original.Digest() {
		t.Fatal(reordered, err)
	}
	f["README.md"][0] = 'X'
	changed, err := CapturePackage(f)
	if err != nil || changed.Digest() == original.Digest() {
		t.Fatal(changed, err)
	}
	delete(f, "README.md")
	missing, err := CapturePackage(f)
	if err != nil || missing.Digest() == original.Digest() {
		t.Fatal(missing, err)
	}
	if string(original.Files()["README.md"]) != "Hello\n" {
		t.Fatal("caller changed snapshot")
	}
	copied := original.Files()
	copied["README.md"][0] = 'Z'
	if string(original.Files()["README.md"]) != "Hello\n" {
		t.Fatal("reader changed snapshot")
	}
}

func canonicalBoundaryFiles(t *testing.T, manifestSize int) map[string][]byte {
	t.Helper()
	files := snapshotFiles(t)
	overhead := len(files["manifest.json"]) - len("Team report")
	remaining := manifestSize - overhead
	description := strings.Repeat("<", remaining/6) + strings.Repeat("x", remaining%6)
	files["manifest.json"] = bytes.Replace(files["manifest.json"], []byte("Team report"), []byte(description), 1)
	if len(files["manifest.json"]) > MaxManifestBytes {
		t.Fatal("raw fixture exceeds manifest limit")
	}
	return files
}
func TestSnapshotChecksCanonicalManifestSize(t *testing.T) {
	for _, size := range []int{MaxManifestBytes, MaxManifestBytes + 1} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			p, err := CapturePackage(canonicalBoundaryFiles(t, size))
			if size == MaxManifestBytes {
				if err != nil || len(p.Files()["manifest.json"]) != size {
					t.Fatal("exact canonical manifest limit rejected", err)
				}
			} else if !errors.Is(err, InvalidPackage) {
				t.Fatalf("expanded canonical manifest accepted: %v", err)
			}
		})
	}
}
func TestSnapshotChecksCanonicalPackageTotal(t *testing.T) {
	for _, extra := range []int{0, 1} {
		t.Run(strconv.Itoa(extra), func(t *testing.T) {
			const canonicalManifestSize = 1000
			files := canonicalBoundaryFiles(t, canonicalManifestSize)
			files["README.md"] = bytes.Repeat([]byte("x"), MaxPackageBytes-canonicalManifestSize-len(files["extension.wasm"])+extra)
			p, err := CapturePackage(files)
			if extra == 0 {
				if err != nil || !ValidDigest(p.Digest()) {
					t.Fatal("exact canonical package limit rejected", err)
				}
			} else if !errors.Is(err, InvalidPackage) {
				t.Fatalf("expanded canonical package total accepted: %v", err)
			}
		})
	}
}
