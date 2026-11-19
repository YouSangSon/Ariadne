//go:build darwin || linux

package files

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ariadne/runtime/internal/platform/nodepath"
	"ariadne/runtime/internal/requirements/application"
	"ariadne/runtime/internal/requirements/domain"
	"golang.org/x/sys/unix"
)

// SourceState fingerprints the Git-selected working tree at a caller-supplied repository root.
func SourceState(root string, reqID *string) (result application.SourceStateResult, err error) {
	directory, err := nodepath.RealPath(root)
	if err != nil {
		return result, err
	}
	rootFD := -1
	defer func() {
		if rootFD >= 0 {
			if closeErr := unix.Close(rootFD); closeErr != nil {
				result = application.SourceStateResult{}
				err = errors.Join(err, closeErr)
			}
		}
	}()
	result, err = application.StreamSourceState(application.StreamSourcePorts{
		InspectGit: func() (application.GitState, error) {
			var openErr error
			rootFD, openErr = openSourceRoot(directory)
			if openErr != nil {
				return application.GitState{}, errGitInspection
			}
			git, err := inspectSourceGit(directory)
			if err == nil && !sourceRootMatches(directory, rootFD) {
				return application.GitState{}, errGitInspection
			}
			return git, err
		},
		SourceHasher: func() (application.SourceHasher, error) { return gitSourceHasher{sha256.New()}, nil },
		WithInput: func(path domain.Text, remaining int64, consume func(application.StreamInput) error) error {
			return withSourceInput(rootFD, directory, path.String(), remaining, consume)
		},
	}, reqID)
	if err == nil && !sourceRootMatches(directory, rootFD) {
		return application.SourceStateResult{}, application.ErrSourceInputChanged
	}
	return result, err
}

type gitSourceHasher struct{ hash.Hash }

func (h gitSourceHasher) Update(data []byte) error {
	_, err := h.Write(data)
	return err
}
func (h gitSourceHasher) Digest() (string, error) { return hex.EncodeToString(h.Sum(nil)), nil }

func openSourceRoot(directory string) (int, error) {
	anchor, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return -1, err
	}
	fd, err := unix.Open("/", searchDirectoryFlags, 0)
	if err != nil {
		return -1, err
	}
	prefix := "/"
	for part := range strings.SplitSeq(strings.TrimPrefix(anchor, "/"), "/") {
		if part == "" {
			continue
		}
		prefix = filepath.Join(prefix, part)
		next, err := openEntry(fd, part, prefix, true)
		if err != nil {
			return -1, errors.Join(err, unix.Close(fd))
		}
		if err := unix.Close(fd); err != nil {
			return -1, errors.Join(err, unix.Close(next))
		}
		fd = next
	}
	return fd, nil
}

func sourceRootMatches(directory string, fd int) bool {
	var anchored, current unix.Stat_t
	return unix.Fstat(fd, &anchored) == nil && unix.Stat(directory, &current) == nil &&
		sourceIdentity(anchored, current)
}

var errMissingSource = errors.New("missing Git input")

func withSourceInput(root int, directory, path string, remaining int64, consume func(application.StreamInput) error) (err error) {
	parts := strings.Split(path, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\x00") {
			return errors.New("Unsafe Git input path")
		}
	}
	parent := root
	defer func() {
		if parent != root {
			if closeErr := unix.Close(parent); closeErr != nil {
				err = errors.Join(err, closeErr)
			}
		}
	}()
	absolute := directory
	for i, part := range parts {
		absolute = filepath.Join(absolute, part)
		before, err := sourceEntry(parent, part, absolute)
		if err == errMissingSource {
			return consumeMissingInput(consume)
		}
		if err != nil {
			return err
		}
		if i == len(parts)-1 {
			return withSourceLeaf(parent, part, absolute, before, remaining, consume)
		}
		switch before.Mode & unix.S_IFMT {
		case unix.S_IFLNK:
			return errors.New("Symbolic link ancestor is not allowed")
		case unix.S_IFDIR:
			next, err := unix.Openat(parent, part, searchDirectoryFlags, 0)
			if err != nil {
				return err
			}
			var opened unix.Stat_t
			if err := unix.Fstat(next, &opened); err != nil {
				return errors.Join(err, unix.Close(next))
			}
			if !sourceIdentity(before, opened) || opened.Mode&unix.S_IFMT != unix.S_IFDIR {
				return errors.Join(application.ErrSourceInputChanged, unix.Close(next))
			}
			old := parent
			parent = next
			if old != root {
				if err := unix.Close(old); err != nil {
					return err
				}
			}
		default:
			return consumeMissingInput(consume)
		}
	}
	return application.ErrSourceInputChanged
}

func consumeMissingInput(consume func(application.StreamInput) error) error {
	return consume(application.StreamInput{Kind: domain.FromString("missing"), Content: bytes.NewReader(nil)})
}

func withSourceLeaf(parent int, name, absolute string, before unix.Stat_t, remaining int64, consume func(application.StreamInput) error) (err error) {
	mode := int64(before.Mode & 0777)
	switch before.Mode & unix.S_IFMT {
	case unix.S_IFLNK:
		var target [unix.PathMax + 1]byte
		size, err := unix.Readlinkat(parent, name, target[:])
		if err != nil {
			return err
		}
		if size == len(target) {
			return application.ErrSourceInputChanged
		}
		content := []byte(decodeNodeUTF8(target[:size]))
		if err := consume(application.StreamInput{Kind: domain.FromString("symlink"), Mode: &mode, Size: int64(len(content)), Content: bytes.NewReader(content)}); err != nil {
			return err
		}
		return sourceEntryMatches(parent, name, absolute, before)
	case unix.S_IFREG:
		fd, openErr := unix.Openat(parent, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
		if openErr != nil {
			return openErr
		}
		file := os.NewFile(uintptr(fd), name)
		defer func() {
			if closeErr := file.Close(); closeErr != nil {
				err = errors.Join(err, closeErr)
			}
		}()
		var opened unix.Stat_t
		if err := unix.Fstat(fd, &opened); err != nil {
			return err
		}
		if changedSource(before, opened) {
			return application.ErrSourceInputChanged
		}
		if err := streamSourceContent(file, opened.Size, remaining, func(content io.Reader, size int64) error {
			return consume(application.StreamInput{Kind: domain.FromString("file"), Mode: &mode, Size: size, Content: content})
		}); err != nil {
			return err
		}
		var after unix.Stat_t
		if err := unix.Fstat(fd, &after); err != nil {
			return err
		}
		if changedSource(opened, after) {
			return application.ErrSourceInputChanged
		}
		return sourceEntryMatches(parent, name, absolute, opened)
	default:
		return errors.New("Source input must be a regular file or symbolic link")
	}
}

func sourceEntry(parent int, name, absolute string) (unix.Stat_t, error) {
	var named, pinned unix.Stat_t
	// The complete prefix preserves the Node path-length and lookup behavior.
	namedErr := unix.Lstat(absolute, &named)
	pinnedErr := unix.Fstatat(parent, name, &pinned, unix.AT_SYMLINK_NOFOLLOW)
	if namedErr == unix.ENOENT || namedErr == unix.ENOTDIR {
		if pinnedErr == unix.ENOENT || pinnedErr == unix.ENOTDIR {
			return pinned, errMissingSource
		}
		return pinned, application.ErrSourceInputChanged
	}
	if namedErr != nil {
		return pinned, namedErr
	}
	if pinnedErr != nil || changedSource(named, pinned) {
		return pinned, application.ErrSourceInputChanged
	}
	return pinned, nil
}

func sourceEntryMatches(parent int, name, absolute string, expected unix.Stat_t) error {
	current, err := sourceEntry(parent, name, absolute)
	if err != nil || changedSource(current, expected) {
		return application.ErrSourceInputChanged
	}
	return nil
}

func sourceIdentity(a, b unix.Stat_t) bool { return a.Dev == b.Dev && a.Ino == b.Ino }

func changedSource(a, b unix.Stat_t) bool {
	return !sourceIdentity(a, b) || a.Mode != b.Mode || a.Size != b.Size || a.Mtim != b.Mtim || a.Ctim != b.Ctim
}
