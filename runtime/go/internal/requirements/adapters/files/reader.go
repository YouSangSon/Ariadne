// Package files supplies the filesystem ports for loading a Requirements contract.
package files

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"unicode/utf8"

	"ariadne/runtime/internal/requirements/application"
	"ariadne/runtime/internal/requirements/domain"
)

// LoadPorts resolves the project root on each read so a caller may retarget its root alias.
func LoadPorts(root string) application.LoadPorts {
	return application.LoadPorts{
		ReadRequirement: func(id string) (domain.Text, error) {
			if _, err := domain.Slug(id); err != nil {
				return domain.Text{}, err
			}
			data, err := readRequirement(root, id+".yaml")
			if err != nil {
				return domain.Text{}, err
			}
			if !utf8.Valid(data) {
				return domain.Text{}, errors.New("REQ must be UTF-8 text")
			}
			text := string(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
			return domain.FromString(strings.ReplaceAll(text, "\r\n", "\n")), nil
		},
		Hash: func(payload []byte) (string, error) {
			sum := sha256.Sum256(payload)
			return hex.EncodeToString(sum[:]), nil
		},
	}
}
