package application

import (
	"errors"
	"io"
	"strings"
	"testing"

	"ariadne/runtime/internal/requirements/domain"
)

type streamProbeHasher struct {
	updates  int
	updateAt int
	failure  error
	digested bool
}

func (h *streamProbeHasher) Update(_ []byte) error {
	h.updates++
	if h.updates == h.updateAt {
		return h.failure
	}
	return nil
}

func (h *streamProbeHasher) Digest() (string, error) {
	h.digested = true
	return "digest", nil
}

type streamReadFailure struct {
	returned bool
	err      error
}

func (r *streamReadFailure) Read(dest []byte) (int, error) {
	if r.returned {
		return 0, io.EOF
	}
	r.returned = true
	return copy(dest, "ab"), r.err
}

func TestStreamSourceStateRejectsPartialFrames(t *testing.T) {
	callbackError := errors.New("stream write or read failure")
	makeFrame := func(input io.Reader) StreamInput {
		return StreamInput{Kind: domain.FromString("file"), Size: 2, Content: input}
	}
	valid := func() StreamInput { return makeFrame(strings.NewReader("ab")) }
	for _, tc := range []struct {
		name    string
		update  int
		want    error
		provide func(func(StreamInput) error)
	}{
		{"missing frame", 0, errSourceFrameCount, func(_ func(StreamInput) error) {}},
		{"duplicate frame", 0, errSourceFrameCount, func(consume func(StreamInput) error) {
			_ = consume(valid())
			_ = consume(valid())
		}},
		{"short frame", 0, ErrSourceInputChanged, func(consume func(StreamInput) error) {
			_ = consume(makeFrame(strings.NewReader("a")))
		}},
		{"oversized frame", 0, ErrSourceInputChanged, func(consume func(StreamInput) error) {
			_ = consume(makeFrame(strings.NewReader("abc")))
		}},
		{"last update failure", 2, callbackError, func(consume func(StreamInput) error) {
			_ = consume(valid())
		}},
		{"read error with exact byte count", 0, callbackError, func(consume func(StreamInput) error) {
			_ = consume(makeFrame(&streamReadFailure{err: callbackError}))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hasher := &streamProbeHasher{updateAt: tc.update, failure: callbackError}
			got, err := StreamSourceState(StreamSourcePorts{
				InspectGit: func() (GitState, error) {
					return GitState{Paths: []domain.Text{domain.FromString("input")}}, nil
				},
				SourceHasher: func() (SourceHasher, error) { return hasher, nil },
				WithInput: func(_ domain.Text, _ int64, consume func(StreamInput) error) error {
					tc.provide(consume)
					return nil
				},
			}, nil)
			if err != tc.want || hasher.digested || got.Hash != "" || got.Head != nil || got.Files != nil {
				t.Fatalf("error=%v digested=%t result=%#v", err, hasher.digested, got)
			}
		})
	}
}

func TestHashSourceContentAcceptsBytesReturnedWithEOF(t *testing.T) {
	hasher := &streamProbeHasher{}
	if err := hashSourceContent(hasher, &streamReadFailure{err: io.EOF}, 2, make([]byte, 8)); err != nil {
		t.Fatal(err)
	}
	if hasher.updates != 1 {
		t.Fatalf("got %d updates for two complete bytes", hasher.updates)
	}
}
