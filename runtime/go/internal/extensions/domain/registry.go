package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"sort"
	"unicode/utf8"
)

type Fault string

func (f Fault) Error() string { return string(f) }

const (
	InvalidPackage    Fault = "INVALID_PACKAGE"
	PackageChanged    Fault = "PACKAGE_CHANGED"
	RegistryUntrusted Fault = "REGISTRY_UNTRUSTED"
	WorkspaceMismatch Fault = "WORKSPACE_MISMATCH"
	UnsupportedSchema Fault = "UNSUPPORTED_REGISTRY_SCHEMA"
	RegistryCorrupt   Fault = "REGISTRY_CORRUPT"
	NotInstalled      Fault = "NOT_INSTALLED"
	RevisionConflict  Fault = "REVISION_CONFLICT"
	ExtensionActive   Fault = "EXTENSION_ACTIVE"
	RemovalPending    Fault = "REMOVAL_PENDING"
	RegistryBusy      Fault = "REGISTRY_BUSY"
	CleanupPending    Fault = "CLEANUP_PENDING"
)

func ValidID(id string) bool         { return len(id) <= 128 && extensionIDPattern.MatchString(id) }
func ValidDigest(digest string) bool { return hashPattern.MatchString(digest) }
func AllowedFile(name string) bool {
	return name == "manifest.json" || name == "extension.wasm" || name == "README.md" || name == "LICENSE"
}

type PackageSnapshot struct {
	manifest Manifest
	digest   string
	files    map[string][]byte
}

func CapturePackage(input map[string][]byte) (PackageSnapshot, error) {
	var total int
	for name, data := range input {
		if !AllowedFile(name) {
			return PackageSnapshot{}, InvalidPackage
		}
		total += len(data)
		if total > MaxPackageBytes || (name != "extension.wasm" && !utf8.Valid(data)) {
			return PackageSnapshot{}, InvalidPackage
		}
	}
	manifest, err := ParseManifest(input["manifest.json"])
	if err != nil {
		return PackageSnapshot{}, InvalidPackage
	}
	wasm := input["extension.wasm"]
	hash := sha256.Sum256(wasm)
	if len(wasm) < 8 || len(wasm) > MaxArtifactBytes || !bytes.Equal(wasm[:8], []byte{0, 'a', 's', 'm', 13, 0, 1, 0}) || hex.EncodeToString(hash[:]) != manifest.ArtifactSHA256 {
		return PackageSnapshot{}, InvalidPackage
	}
	canonical, err := json.Marshal(manifest)
	if err != nil || len(canonical) > MaxManifestBytes || total-len(input["manifest.json"])+len(canonical) > MaxPackageBytes {
		return PackageSnapshot{}, InvalidPackage
	}
	files := make(map[string][]byte, len(input))
	names := make([]string, 0, len(input))
	for name, data := range input {
		files[name] = bytes.Clone(data)
		names = append(names, name)
	}
	files["manifest.json"] = canonical
	sort.Strings(names)
	h := sha256.New()
	h.Write([]byte("ariadne.package/1\x00"))
	for _, name := range names {
		binary.Write(h, binary.BigEndian, uint32(len(name)))
		h.Write([]byte(name))
		binary.Write(h, binary.BigEndian, uint32(len(files[name])))
		h.Write(files[name])
	}
	return PackageSnapshot{manifest: manifest, digest: hex.EncodeToString(h.Sum(nil)), files: files}, nil
}
func (p PackageSnapshot) Digest() string { return p.digest }
func (p PackageSnapshot) Manifest() Manifest {
	m := p.manifest
	m.RequestedCapabilities = append([]string{}, m.RequestedCapabilities...)
	return m
}
func (p PackageSnapshot) Files() map[string][]byte {
	result := make(map[string][]byte, len(p.files))
	for k, v := range p.files {
		result[k] = bytes.Clone(v)
	}
	return result
}

type PackageView struct {
	Digest           string `json:"digest"`
	Version          string `json:"version"`
	Status           string `json:"status"`
	RuntimeQualified bool   `json:"runtimeQualified"`
}
type RegistryView struct {
	ExtensionID      string        `json:"extensionId"`
	Revision         int64         `json:"revision"`
	SelectedDigest   string        `json:"selectedDigest,omitempty"`
	Enabled          bool          `json:"enabled"`
	Packages         []PackageView `json:"packages"`
	OrphanArtifacts  []string      `json:"orphanArtifacts"`
	StagingEntries   []string      `json:"stagingEntries"`
	RuntimeQualified bool          `json:"runtimeQualified"`
	CleanupPending   bool          `json:"cleanupPending"`
}

func (v RegistryView) CheckRevision(expected int64) error {
	if expected < 0 || v.Revision != expected {
		return RevisionConflict
	}
	return nil
}
func (v RegistryView) CanRemove(digest string) error {
	if v.Enabled && v.SelectedDigest == digest {
		return ExtensionActive
	}
	return nil
}
