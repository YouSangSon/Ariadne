//go:build !darwin && !linux

package corefiles

import (
	coreapp "ariadne/runtime/internal/core/application"
	"errors"
)

func (r Reader) read(root string, parts []string) ([]byte, coreapp.FileIdentity, error) {
	return nil, coreapp.FileIdentity{}, errors.New("Project text reads are unsupported on this platform")
}
