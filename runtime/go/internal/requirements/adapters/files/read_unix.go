//go:build darwin || linux

package files

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ariadne/runtime/internal/platform/nodepath"
	"golang.org/x/sys/unix"
)

const maxBytes = 1 << 20

var missing = errors.New("REQ must be a regular file, not a missing file or symlink")

func readRequirement(root, name string) (data []byte, err error) {
	root, err = nodepath.RealPath(root)
	if err != nil {
		return nil, err
	}
	anchor, err := filepath.EvalSymlinks(root)
	if errors.Is(err, unix.ENOENT) || errors.Is(err, unix.ENOTDIR) {
		return nil, missing
	}
	if err != nil {
		return nil, err
	}
	fd, err := unix.Open("/", searchDirectoryFlags, 0)
	if err != nil {
		return nil, err
	}
	defer func() {
		if e := unix.Close(fd); e != nil {
			data = nil
			err = errors.Join(err, e)
		}
	}()

	parts := strings.FieldsFunc(anchor, func(r rune) bool { return r == '/' })
	nRoot := len(parts)
	prefix := "/"
	for i, part := range append(parts, ".harness", "reqs") {
		if i == nRoot {
			prefix = root
		}
		prefix = filepath.Join(prefix, part)
		next, e := openEntry(fd, part, prefix, true)
		if e != nil {
			return nil, e
		}
		old := fd
		fd = next
		if e = unix.Close(old); e != nil {
			return nil, e
		}
	}
	leaf, err := openEntry(fd, name, filepath.Join(prefix, name), false)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(leaf), name)
	defer func() {
		if e := file.Close(); e != nil {
			data = nil
			err = errors.Join(err, e)
		}
	}()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > maxBytes {
		return nil, errors.New("File size exceeds 1 MiB")
	}
	data, err = io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, errors.New("File size exceeds 1 MiB")
	}
	return data, nil
}

func openEntry(parent int, name, absolute string, directory bool) (int, error) {
	var before unix.Stat_t
	// Node inspects the full prefix; a descriptor-relative lookup alone admits overlong paths.
	err := unix.Lstat(absolute, &before)
	if errors.Is(err, unix.ENOENT) || errors.Is(err, unix.ENOTDIR) {
		return -1, missing
	}
	if err != nil {
		return -1, err
	}
	kind := before.Mode & unix.S_IFMT
	flags := unix.O_RDONLY | unix.O_NONBLOCK | unix.O_CLOEXEC | unix.O_NOFOLLOW
	if directory {
		if kind == unix.S_IFLNK {
			return -1, errors.New("Symbolic link ancestor is not allowed")
		}
		if kind != unix.S_IFDIR {
			return -1, missing
		}
		flags = searchDirectoryFlags
	} else {
		if kind == unix.S_IFLNK {
			return -1, missing
		}
		if kind != unix.S_IFREG {
			return -1, errors.New("Source input must be a regular file or symbolic link")
		}
	}
	fd, err := unix.Openat(parent, name, flags, 0)
	if err != nil {
		return -1, err
	}
	var opened unix.Stat_t
	err = unix.Fstat(fd, &opened)
	if err == nil && (opened.Dev != before.Dev || opened.Ino != before.Ino || opened.Mode&unix.S_IFMT != kind) {
		err = errors.New("REQ path changed during read")
	}
	if err != nil {
		return -1, errors.Join(err, unix.Close(fd))
	}
	return fd, nil
}
