//go:build darwin || linux

package corefiles

import (
	"golang.org/x/text/encoding/unicode"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// resolveRoot preserves Node's lexical root/link choices before pinning an OS anchor.
// This is private root resolution; project-relative ancestors still use the FD walk.
func resolveRoot(root string) (string, error) {
	if !filepath.IsAbs(root) {
		cwd, err := syscall.Getwd()
		if err != nil {
			return "", err
		}
		cwd, _ = unicode.UTF8.NewDecoder().String(cwd)
		root = filepath.Join(cwd, root)
	}
	root = filepath.Clean(root)
	// shortcut: decoded-only link cycles can block like Node; add limits only with a shared policy change.
	for {
		parts := strings.Split(strings.TrimPrefix(root, "/"), "/")
		current := "/"
		restart := false
		for i, part := range parts {
			if part == "" {
				continue
			}
			current = filepath.Join(current, part)
			info, err := os.Lstat(current)
			if err != nil {
				return "", err
			}
			if info.Mode()&os.ModeSymlink == 0 {
				continue
			}
			// Raw target failure precedes decoding, including dangling links and OS ELOOP.
			if _, err = os.Stat(current); err != nil {
				return "", err
			}
			target, err := os.Readlink(current)
			if err != nil {
				return "", err
			}
			target, _ = unicode.UTF8.NewDecoder().String(target)
			if filepath.IsAbs(target) {
				root = filepath.Clean(target)
			} else {
				root = filepath.Join(filepath.Dir(current), target)
			}
			if i+1 < len(parts) {
				root = filepath.Join(root, filepath.Join(parts[i+1:]...))
			}
			restart = true
			break
		}
		if !restart {
			// The physical OS anchor must not be decoded again.
			return filepath.EvalSymlinks(root)
		}
	}
}
