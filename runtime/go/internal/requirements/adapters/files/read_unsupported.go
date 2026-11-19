//go:build !darwin && !linux

package files

import "errors"

func readRequirement(root, name string) ([]byte, error) {
	return nil, errors.New("REQ file reads are unsupported on this platform")
}
