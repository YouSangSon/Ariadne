//go:build darwin || linux

package corefiles

import (
	coreapp "ariadne/runtime/internal/core/application"
	"ariadne/runtime/internal/core/domain/projectfiles"
	"errors"
	"golang.org/x/sys/unix"
	"strings"
)

const directoryFlags = unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_CLOEXEC

func identity(s unix.Stat_t) coreapp.FileIdentity {
	return coreapp.FileIdentity{Device: uint64(s.Dev), Inode: uint64(s.Ino)}
}
func drift() error { return errors.New("Project file changed during read") }
func inspect(fd int, part string, directory bool) (unix.Stat_t, error) {
	var s unix.Stat_t
	if err := unix.Fstatat(fd, part, &s, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		if errors.Is(err, unix.ENOENT) {
			return s, errors.New("Project file does not exist")
		}
		return s, err
	}
	if s.Mode&unix.S_IFMT == unix.S_IFLNK {
		return s, errors.New("Symbolic links are denied")
	}
	if directory && s.Mode&unix.S_IFMT != unix.S_IFDIR {
		return s, errors.New("Project path ancestor must be a directory")
	}
	if !directory && s.Mode&unix.S_IFMT != unix.S_IFREG {
		return s, errors.New("Project path must be a regular file")
	}
	return s, nil
}
func (r Reader) close(fd int) error {
	if r.closeFD != nil {
		return r.closeFD(fd)
	}
	return unix.Close(fd)
}
func (r Reader) read(root string, parts []string) (data []byte, id coreapp.FileIdentity, err error) {
	canonical, err := resolveRoot(root)
	if err != nil {
		return nil, id, err
	}
	r.observed("canonical-root", canonical)
	fd, err := unix.Open("/", directoryFlags, 0)
	if err != nil {
		return nil, id, err
	}
	defer func() {
		err = errors.Join(err, r.close(fd))
		if err != nil {
			data = nil
		}
	}()
	// Close each parent as soon as its child is pinned: depth never grows FD count.
	walk := func(part, stage, observedPath string) error {
		before, e := inspect(fd, part, true)
		if e != nil {
			return e
		}
		r.observed(stage, observedPath)
		child, e := unix.Openat(fd, part, directoryFlags, 0)
		if e != nil {
			return e
		}
		var opened unix.Stat_t
		e = unix.Fstat(child, &opened)
		current, check := inspect(fd, part, true)
		if e == nil {
			e = check
		}
		if e == nil && (identity(before) != identity(opened) || identity(current) != identity(opened)) {
			e = drift()
		}
		if e != nil {
			return errors.Join(e, r.close(child))
		}
		old := fd
		fd = child
		return r.close(old)
	}
	for _, part := range strings.Split(strings.TrimPrefix(canonical, "/"), "/") {
		if part != "" {
			if e := walk(part, "root-before-open", part); e != nil {
				return nil, id, e
			}
		}
	}
	for i, part := range parts[:len(parts)-1] {
		if e := walk(part, "ancestor-before-open", strings.Join(parts[:i+1], "/")); e != nil {
			return nil, id, e
		}
	}
	leaf := parts[len(parts)-1]
	before, err := inspect(fd, leaf, false)
	if err != nil {
		return nil, id, err
	}
	r.observed("leaf-before-open", leaf)
	leafFD, err := unix.Openat(fd, leaf, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, id, err
	}
	defer func() {
		err = errors.Join(err, r.close(leafFD))
		if err != nil {
			data = nil
		}
	}()
	var opened unix.Stat_t
	if err = unix.Fstat(leafFD, &opened); err != nil {
		return nil, id, err
	}
	if opened.Mode&unix.S_IFMT != unix.S_IFREG {
		return nil, id, errors.New("Project path must be a regular file")
	}
	current, err := inspect(fd, leaf, false)
	if err != nil {
		return nil, id, err
	}
	if identity(before) != identity(opened) || identity(current) != identity(opened) {
		return nil, id, drift()
	}
	if opened.Size > projectfiles.MaxBytes {
		return nil, id, errors.New("File size exceeds 1 MiB")
	}
	r.observed("read-before", leaf)
	data = make([]byte, projectfiles.MaxBytes+1)
	size := 0
	for size < len(data) {
		n, e := unix.Read(leafFD, data[size:])
		if n > 0 {
			size += n
		}
		if e == unix.EINTR {
			continue
		}
		if e != nil {
			return nil, id, e
		}
		if n == 0 {
			break
		}
	}
	if size > projectfiles.MaxBytes {
		return nil, id, errors.New("File size exceeds 1 MiB")
	}
	r.observed("read-after", leaf)
	var after unix.Stat_t
	if err = unix.Fstat(leafFD, &after); err != nil {
		return nil, id, err
	}
	current, err = inspect(fd, leaf, false)
	if err != nil {
		return nil, id, err
	}
	if identity(current) != identity(opened) || changed(opened, after) || changed(opened, current) {
		return nil, id, drift()
	}
	return data[:size], identity(opened), nil
}

func changed(a, b unix.Stat_t) bool {
	return identity(a) != identity(b) || a.Mode != b.Mode || a.Size != b.Size || a.Mtim != b.Mtim || a.Ctim != b.Ctim
}
