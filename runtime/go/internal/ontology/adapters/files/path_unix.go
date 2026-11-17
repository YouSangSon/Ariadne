//go:build darwin || linux

package ontologyfiles

import (
	"golang.org/x/text/encoding/unicode"
	"path/filepath"
	"syscall"
)

func absoluteFile(file string) (string, error) {
	if filepath.IsAbs(file) {
		return filepath.Clean(file), nil
	}
	cwd, err := syscall.Getwd()
	if err != nil {
		return "", err
	}
	cwd, _ = unicode.UTF8.NewDecoder().String(cwd)
	return filepath.Join(cwd, file), nil
}
