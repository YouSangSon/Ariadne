//go:build !darwin && !linux

package contextfiles

import "errors"

func (s Store) ListSkills() ([]string, error) {
	return nil, errors.New("skill catalog directory reads are unavailable on this platform")
}
