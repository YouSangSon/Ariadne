//go:build darwin || linux

package files

import (
	"bytes"
	"errors"
	"io"
	"os"

	"ariadne/runtime/internal/requirements/application"
	"golang.org/x/sys/unix"
)

const sourceChunkSize = 64 << 10

func streamSourceContent(file *os.File, advertised, remaining int64, consume func(io.Reader, int64) error) error {
	matches, err := sourceLengthMatches(file, advertised)
	if err != nil {
		return err
	}
	if matches {
		if advertised > remaining {
			return application.ErrSourceInputLimit
		}
		return consume(file, advertised)
	}

	// Some regular descriptors report a size that differs from the bytes they return.
	memoryLimit := min(int64(sourceChunkSize), remaining)
	prefix, err := io.ReadAll(io.LimitReader(file, memoryLimit+1))
	if err != nil {
		return err
	}
	size := int64(len(prefix))
	if size > remaining {
		return application.ErrSourceInputLimit
	}
	if size <= memoryLimit {
		return consume(bytes.NewReader(prefix), size)
	}
	return spoolSourceContent(file, prefix, remaining, consume)
}

func sourceLengthMatches(file *os.File, size int64) (bool, error) {
	if size < 0 {
		return false, application.ErrSourceInputChanged
	}
	var probe [1]byte
	if size > 0 {
		if _, err := file.ReadAt(probe[:], size-1); err != nil {
			if errors.Is(err, io.EOF) || cannotPosition(err) {
				return false, nil
			}
			return false, err
		}
	}
	_, err := file.ReadAt(probe[:], size)
	if errors.Is(err, io.EOF) {
		return true, nil
	}
	if cannotPosition(err) {
		return false, nil
	}
	return false, err
}

func cannotPosition(err error) bool {
	return errors.Is(err, unix.ESPIPE) || errors.Is(err, unix.EINVAL) || errors.Is(err, unix.EOPNOTSUPP)
}

func spoolSourceContent(file io.Reader, prefix []byte, remaining int64, consume func(io.Reader, int64) error) (err error) {
	spool, err := os.CreateTemp("", "ariadne-git-source-")
	if err != nil {
		return err
	}
	// The spool has no directory entry when the first source byte is written.
	if unlinkErr := os.Remove(spool.Name()); unlinkErr != nil {
		owned, statErr := spool.Stat()
		closeErr := spool.Close()
		current, lookupErr := os.Lstat(spool.Name())
		if statErr == nil && lookupErr == nil && os.SameFile(owned, current) {
			return errors.Join(unlinkErr, closeErr, os.Remove(spool.Name()))
		}
		return errors.Join(unlinkErr, closeErr)
	}
	defer func() {
		if closeErr := spool.Close(); closeErr != nil {
			err = errors.Join(err, closeErr)
		}
	}()
	if _, err := spool.Write(prefix); err != nil {
		return err
	}
	left := remaining - int64(len(prefix))
	n, err := io.CopyBuffer(spool, io.LimitReader(file, left), make([]byte, sourceChunkSize))
	if err != nil {
		return err
	}
	if n == left {
		var extra [1]byte
		if n, err := io.ReadFull(file, extra[:]); n > 0 {
			return application.ErrSourceInputLimit
		} else if !errors.Is(err, io.EOF) {
			return err
		}
	}
	if _, err := spool.Seek(0, io.SeekStart); err != nil {
		return err
	}
	return consume(spool, int64(len(prefix))+n)
}
