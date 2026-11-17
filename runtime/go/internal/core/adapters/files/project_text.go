package corefiles

import (
	coreapp "ariadne/runtime/internal/core/application"
	"ariadne/runtime/internal/core/domain/projectfiles"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"unicode/utf8"
)

// Reader owns descriptors for one call. Hooks only observe private test boundaries.
type Reader struct {
	observe func(stage, path string)
	closeFD func(int) error
}

func (r Reader) ReadProjectText(root, path string) (coreapp.ProjectText, error) {
	parts, err := projectfiles.Path(path)
	if err != nil {
		return coreapp.ProjectText{}, err
	}
	data, identity, err := r.read(root, parts)
	if err != nil {
		return coreapp.ProjectText{}, err
	}
	if !utf8.Valid(data) {
		return coreapp.ProjectText{}, errors.New("Project files must contain UTF-8 text")
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return coreapp.ProjectText{}, errors.New("Binary project files are denied")
	}
	hash := sha256.Sum256(data)
	return coreapp.ProjectText{Bytes: data, SHA256: hex.EncodeToString(hash[:]), Identity: identity}, nil
}
func (r Reader) observed(stage, path string) {
	if r.observe != nil {
		r.observe(stage, path)
	}
}
