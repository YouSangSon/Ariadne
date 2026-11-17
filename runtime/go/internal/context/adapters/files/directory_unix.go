//go:build darwin || linux

package contextfiles

import (
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
)

func (s Store) ListSkills() (names []string, err error) {
	path := filepath.Join(s.root, "skills")
	before, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	if before.Mode()&os.ModeSymlink != 0 || !before.IsDir() {
		return nil, errors.New("skills must be a local directory, not a symbolic link")
	}
	if s.observe != nil {
		s.observe(path)
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	defer func() {
		var closeErr error
		if s.closeDirectory != nil {
			closeErr = s.closeDirectory(f)
		} else {
			closeErr = f.Close()
		}
		err = errors.Join(err, closeErr)
		if err != nil {
			names = nil
		}
	}()
	opened, err := f.Stat()
	if err != nil {
		return nil, err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !opened.IsDir() || !os.SameFile(before, opened) || !os.SameFile(current, opened) {
		return nil, errors.New("Skill directory changed during read")
	}
	entries, err := f.ReadDir(101)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	if len(entries) > 100 {
		return nil, errors.New("skill catalog exceeds 100 entries")
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 {
			return nil, errors.New("skill symbolic links are denied")
		}
	}
	names = []string{}
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, lossy(entry.Name()))
		}
	}
	sortUTF16(names)
	return names, nil
}
