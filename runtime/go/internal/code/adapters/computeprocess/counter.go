// Package computeprocess composes the Code wire contract with the opaque runner.
package computeprocess

import (
	"ariadne/runtime/internal/code/adapters/computewire"
	"ariadne/runtime/internal/code/domain"
	process "ariadne/runtime/internal/platform/computeprocess"
	"context"
	"crypto/rand"
	"encoding/hex"
)

type Counter struct{ runner *process.Runner }

func New(runner *process.Runner) *Counter { return &Counter{runner: runner} }
func (c *Counter) CountCoChanges(ctx context.Context, input domain.CoChangeInput) (domain.CoChangeCounts, error) {
	if err := ctx.Err(); err != nil {
		return domain.CoChangeCounts{}, classifyContext(err)
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return domain.CoChangeCounts{}, process.Unavailable
	}
	request, err := computewire.NewRequest(hex.EncodeToString(id[:]), input)
	if err != nil {
		return domain.CoChangeCounts{}, err
	}
	raw, err := computewire.EncodeRequest(request)
	if err != nil {
		return domain.CoChangeCounts{}, err
	}
	var response computewire.Response
	diagnostics, err := c.runner.Run(ctx, raw, process.FrameLimits{Request: computewire.MaxRequestBytes, Response: computewire.MaxResponseBytes}, func(ctx context.Context, frame []byte) error {
		var err error
		response, err = computewire.DecodeResponseContext(ctx, frame, request)
		return err
	})
	if err != nil {
		if err == process.Cancelled || err == process.DeadlineExceeded {
			err = classifyContext(err)
		}
		if !diagnostics.CleanupConfirmed {
			return domain.CoChangeCounts{}, &process.Failure{Cause: err, Diagnostics: diagnostics}
		}
		return domain.CoChangeCounts{}, err
	}
	if err = ctx.Err(); err != nil {
		return domain.CoChangeCounts{}, classifyContext(err)
	}
	if response.Code != "" {
		return domain.CoChangeCounts{}, computewire.Error(response.Code)
	}
	return *response.Counts, nil
}

func classifyContext(err error) error {
	if err == context.DeadlineExceeded || err == process.DeadlineExceeded {
		return &contextFailure{code: process.DeadlineExceeded, cause: context.DeadlineExceeded}
	}
	return &contextFailure{code: process.Cancelled, cause: context.Canceled}
}

type contextFailure struct {
	code  process.Error
	cause error
}

func (e *contextFailure) Error() string        { return e.code.Error() }
func (e *contextFailure) Unwrap() error        { return e.cause }
func (e *contextFailure) Is(target error) bool { return target == e.code }
