//go:build darwin || linux

// Package nodepath resolves caller-supplied roots with Node path semantics.
package nodepath

import (
	"golang.org/x/text/encoding/unicode"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// RealPath preserves Node's lexical root/link choices before pinning an OS anchor.
// File adapters pin the returned path and apply their own rules to project entries.
func RealPath(root string) (string, error) {
	if strings.IndexByte(root, 0) >= 0 {
		return "", syscall.EINVAL
	}
	if !filepath.IsAbs(root) {
		cwd, err := syscall.Getwd()
		if err != nil {
			return "", err
		}
		cwd, _ = unicode.UTF8.NewDecoder().String(cwd)
		root = filepath.Join(cwd, root)
	}
	root = filepath.Clean(root)
	knownHardPaths := make(map[string]bool)
	type linkID struct {
		device uint64
		inode  uint64
	}
	links := make(map[linkID]string)
	reachedPipeOrSocket := false
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
			if knownHardPaths[current] {
				if reachedPipeOrSocket {
					return root, nil
				}
				continue
			}
			info, err := os.Lstat(current)
			if err != nil {
				return "", err
			}
			if info.Mode()&os.ModeSymlink == 0 {
				knownHardPaths[current] = true
				continue
			}
			stat := info.Sys().(*syscall.Stat_t)
			id := linkID{uint64(stat.Dev), stat.Ino}
			target, cached := links[id]
			if !cached {
				// Node checks the raw target before decoding the link text.
				raw, err := os.Stat(current)
				if err != nil {
					return "", err
				}
				reachedPipeOrSocket = raw.Mode()&(os.ModeNamedPipe|os.ModeSocket) != 0
				target, err = os.Readlink(current)
				if err != nil {
					return "", err
				}
				target, _ = unicode.UTF8.NewDecoder().String(target)
				links[id] = target
			}
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
			return root, nil
		}
	}
}
