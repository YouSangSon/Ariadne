// Package computeprocess owns opaque framed process I/O, never Code values.
package computeprocess

import (
	"bytes"
	"encoding/binary"
	"io"
)

type Error string

func (e Error) Error() string { return string(e) }

const (
	InvalidInput       Error = "INVALID_INPUT"
	UnsupportedVersion Error = "UNSUPPORTED_VERSION"
	LimitExceeded      Error = "LIMIT_EXCEEDED"
	Unavailable        Error = "UNAVAILABLE"
	Busy               Error = "BUSY"
	Cancelled          Error = "CANCELLED"
	DeadlineExceeded   Error = "DEADLINE_EXCEEDED"
	ProtocolError      Error = "PROTOCOL_ERROR"
	EngineFailed       Error = "ENGINE_FAILED"
)

type FrameLimits struct{ Request, Response uint32 }

func writeFrame(w io.Writer, raw []byte) error {
	var prefix [4]byte
	binary.BigEndian.PutUint32(prefix[:], uint32(len(raw)))
	if _, err := w.Write(prefix[:]); err != nil {
		return err
	}
	_, err := io.Copy(w, bytes.NewReader(raw))
	return err
}
func readFrame(r io.Reader, limit uint32) ([]byte, error) {
	var prefix [4]byte
	if _, err := io.ReadFull(r, prefix[:]); err != nil {
		if err == io.EOF {
			return nil, EngineFailed
		}
		return nil, ProtocolError
	}
	n := binary.BigEndian.Uint32(prefix[:])
	if n > limit {
		return nil, LimitExceeded
	}
	if n == 0 {
		return nil, ProtocolError
	}
	raw := make([]byte, int(n))
	if _, err := io.ReadFull(r, raw); err != nil {
		return nil, ProtocolError
	}
	return raw, nil
}

// Failure preserves nonsecret lifecycle evidence when cleanup cannot be confirmed.
type Failure struct {
	Cause       error
	Diagnostics Diagnostics
}

func (e *Failure) Error() string { return e.Cause.Error() }
func (e *Failure) Unwrap() error { return e.Cause }
