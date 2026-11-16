package files

import (
	"ariadne/runtime/internal/extensions/application"
	"ariadne/runtime/internal/extensions/domain"
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

type Reader struct{}

var _ application.PackageReader = Reader{}

func (Reader) ReadPackage(directory string) (domain.PackageSnapshot, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return domain.PackageSnapshot{}, domain.InvalidPackage
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return domain.PackageSnapshot{}, domain.InvalidPackage
	}
	entries, readErr := dir.ReadDir(5)
	closeErr := dir.Close()
	if (readErr != nil && readErr != io.EOF) || closeErr != nil || len(entries) > 4 {
		return domain.PackageSnapshot{}, domain.InvalidPackage
	}
	captured := make(map[string][]byte, len(entries))
	var total int
	for _, entry := range entries {
		name := entry.Name()
		if !domain.AllowedFile(name) {
			return domain.PackageSnapshot{}, domain.InvalidPackage
		}
		limit := domain.MaxPackageBytes
		if name == "manifest.json" {
			limit = domain.MaxManifestBytes
		}
		if name == "extension.wasm" {
			limit = domain.MaxArtifactBytes
		}
		data, err := readFile(root, name, limit)
		if err != nil {
			return domain.PackageSnapshot{}, err
		}
		total += len(data)
		if total > domain.MaxPackageBytes {
			return domain.PackageSnapshot{}, domain.InvalidPackage
		}
		captured[name] = data
	}
	return domain.CapturePackage(captured)
}

func Inspect(directory string) (Inspection, error) {
	snapshot, err := (Reader{}).ReadPackage(directory)
	if err != nil {
		return Inspection{}, err
	}
	return Inspection{Manifest: snapshot.Manifest(), ArtifactStatus: "component-header-only", RuntimeQualified: false}, nil
}

func readFile(root *os.Root, name string, maxBytes int) ([]byte, error) {
	return readFileObserved(root, name, maxBytes, nil)
}
func readFileObserved(root *os.Root, name string, maxBytes int, openedHook func()) ([]byte, error) {
	before, err := root.Lstat(name)
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0111 != 0 || before.Size() > int64(maxBytes) {
		return nil, domain.InvalidPackage
	}
	// Nonblocking open prevents a concurrent FIFO replacement from blocking inspection.
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, domain.InvalidPackage
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, domain.PackageChanged
	}
	if openedHook != nil {
		openedHook()
	}
	data, err := io.ReadAll(io.LimitReader(f, int64(maxBytes)+1))
	if err != nil || len(data) > maxBytes {
		return nil, domain.InvalidPackage
	}
	after, err := f.Stat()
	current, pathErr := root.Lstat(name)
	if err != nil || pathErr != nil || !os.SameFile(opened, current) || opened.Size() != after.Size() || !opened.ModTime().Equal(after.ModTime()) || opened.Mode() != after.Mode() || int64(len(data)) != after.Size() {
		return nil, domain.PackageChanged
	}
	return data, nil
}
