//go:build darwin || linux

package contextcli

import (
	"golang.org/x/text/encoding/unicode"
	"syscall"
)

func cwd() (string, error) {
	root, err := syscall.Getwd()
	if err != nil {
		return "", err
	}
	root, _ = unicode.UTF8.NewDecoder().String(root)
	return root, nil
}
