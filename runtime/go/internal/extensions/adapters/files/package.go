package files

import (
	"ariadne/runtime/internal/extensions/domain"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

type Inspection struct {
	Manifest         domain.Manifest `json:"manifest"`
	ArtifactStatus   string          `json:"artifactStatus"`
	RuntimeQualified bool            `json:"runtimeQualified"`
}

func ReadInput(filename string, maxBytes int) ([]byte, error) {
	if maxBytes <= 0 || maxBytes > domain.MaxInputBytes {
		return nil, errors.New("invalid input limit")
	}
	root, err := os.OpenRoot(filepath.Dir(filename))
	if err != nil {
		return nil, errors.New("input directory unavailable")
	}
	defer root.Close()
	return readFile(root, filepath.Base(filename), maxBytes)
}

func Inspect(directory string) (Inspection, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return Inspection{}, errors.New("package directory unavailable")
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return Inspection{}, errors.New("package directory unavailable")
	}
	entries, readErr := dir.ReadDir(33)
	closeErr := dir.Close()
	if (readErr != nil && readErr != io.EOF) || closeErr != nil || len(entries) > 32 {
		return Inspection{}, errors.New("package file list invalid")
	}
	var total int64
	for _, entry := range entries {
		if entry.Name() != "manifest.json" && entry.Name() != "extension.wasm" && entry.Name() != "LICENSE" && entry.Name() != "README.md" {
			return Inspection{}, errors.New("unexpected package file")
		}
		info, err := root.Lstat(entry.Name())
		if err != nil || !info.Mode().IsRegular() {
			return Inspection{}, errors.New("package files must be regular")
		}
		total += info.Size()
		if total > domain.MaxPackageBytes {
			return Inspection{}, errors.New("package exceeds size limit")
		}
	}
	manifestBytes, err := readFile(root, "manifest.json", domain.MaxManifestBytes)
	if err != nil {
		return Inspection{}, err
	}
	manifest, err := domain.ParseManifest(manifestBytes)
	if err != nil {
		return Inspection{}, errors.New("invalid extension manifest")
	}
	wasm, err := readFile(root, "extension.wasm", domain.MaxArtifactBytes)
	if err != nil {
		return Inspection{}, err
	}
	if len(wasm) < 8 || !bytes.Equal(wasm[:8], []byte{0, 'a', 's', 'm', 13, 0, 1, 0}) {
		return Inspection{}, errors.New("artifact is not a WebAssembly component")
	}
	hash := sha256.Sum256(wasm)
	if hex.EncodeToString(hash[:]) != manifest.ArtifactSHA256 {
		return Inspection{}, errors.New("artifact digest mismatch")
	}
	return Inspection{Manifest: manifest, ArtifactStatus: "component-header-only", RuntimeQualified: false}, nil
}

func readFile(root *os.Root, name string, maxBytes int) ([]byte, error) {
	before, err := root.Lstat(name)
	if err != nil || !before.Mode().IsRegular() || before.Size() > int64(maxBytes) {
		return nil, errors.New("package file unavailable or exceeds limit")
	}
	// Nonblocking open prevents a concurrent FIFO replacement from blocking inspection.
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, errors.New("package file unavailable")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, errors.New("package file changed")
	}
	data, err := io.ReadAll(io.LimitReader(f, int64(maxBytes)+1))
	if err != nil || len(data) > maxBytes {
		return nil, errors.New("package file unreadable or exceeds limit")
	}
	return data, nil
}
