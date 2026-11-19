//go:build !darwin && !linux

package ontologyfiles

import (
	"errors"
	"path/filepath"
)

func absoluteFile(file string) (string, error) {
	if filepath.IsAbs(file) {
		return filepath.Clean(file), nil
	}
	return "", errors.New("physical current directory is unavailable on this platform")
}
