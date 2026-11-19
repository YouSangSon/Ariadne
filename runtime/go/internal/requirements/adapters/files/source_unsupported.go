//go:build !darwin && !linux

package files

import (
	"errors"

	"ariadne/runtime/internal/requirements/application"
)

func SourceState(root string, reqID *string) (application.SourceStateResult, error) {
	return application.SourceStateResult{}, errors.New("Git source inspection is unsupported on this platform")
}
