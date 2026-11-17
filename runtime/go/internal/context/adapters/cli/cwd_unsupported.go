//go:build !darwin && !linux

package contextcli

import "errors"

func cwd() (string, error) {
	return "", errors.New("physical current directory is unavailable on this platform")
}
