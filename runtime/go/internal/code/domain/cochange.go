package domain

import (
	"errors"
	"sort"
)

const (
	MaxCommits        = 1500
	MaxFilesPerCommit = 25
	MaxFiles          = 37500
	MaxPairs          = 450000
)

type CoChangeInput struct {
	FileCount uint32
	Commits   [][]uint32
}
type PairCount struct{ A, B, Count, FirstSeenOrdinal uint32 }
type CoChangeCounts struct {
	Frequencies []uint32
	Pairs       []PairCount
}

var ErrInvalidInput = errors.New("INVALID_INPUT")
var ErrLimitExceeded = errors.New("LIMIT_EXCEEDED")

func ValidateInput(input CoChangeInput) error {
	if input.FileCount > MaxFiles || len(input.Commits) > MaxCommits {
		return ErrLimitExceeded
	}
	for _, commit := range input.Commits {
		if len(commit) > MaxFilesPerCommit {
			return ErrLimitExceeded
		}
		for i, id := range commit {
			if id >= input.FileCount || i > 0 && commit[i-1] >= id {
				return ErrInvalidInput
			}
		}
	}
	return nil
}

func CountReference(input CoChangeInput) (CoChangeCounts, error) {
	if err := ValidateInput(input); err != nil {
		return CoChangeCounts{}, err
	}
	counts := CoChangeCounts{Frequencies: make([]uint32, input.FileCount), Pairs: make([]PairCount, 0)}
	pairs := make(map[[2]uint32]PairCount)
	for _, commit := range input.Commits {
		for _, id := range commit {
			counts.Frequencies[id]++
		}
		for i, a := range commit {
			for _, b := range commit[i+1:] {
				key := [2]uint32{a, b}
				pair, exists := pairs[key]
				if !exists {
					if len(pairs) == MaxPairs {
						return CoChangeCounts{}, ErrLimitExceeded
					}
					pair = PairCount{A: a, B: b, FirstSeenOrdinal: uint32(len(pairs))}
				}
				pair.Count++
				pairs[key] = pair
			}
		}
	}
	for _, pair := range pairs {
		counts.Pairs = append(counts.Pairs, pair)
	}
	sort.Slice(counts.Pairs, func(i, j int) bool {
		a, b := counts.Pairs[i], counts.Pairs[j]
		return a.A < b.A || a.A == b.A && a.B < b.B
	})
	return counts, nil
}

// ValidateCounts checks the result contract without repeating the count kernel.
func ValidateCounts(input CoChangeInput, counts CoChangeCounts) error {
	if err := ValidateInput(input); err != nil {
		return err
	}
	if len(counts.Frequencies) != int(input.FileCount) {
		return ErrInvalidInput
	}
	if len(counts.Pairs) > MaxPairs {
		return ErrLimitExceeded
	}
	for _, frequency := range counts.Frequencies {
		if frequency > uint32(len(input.Commits)) {
			return ErrInvalidInput
		}
	}
	ordinals := make([]bool, len(counts.Pairs))
	for i, pair := range counts.Pairs {
		if pair.A >= pair.B || pair.B >= input.FileCount || pair.Count == 0 ||
			pair.Count > counts.Frequencies[pair.A] || pair.Count > counts.Frequencies[pair.B] ||
			pair.FirstSeenOrdinal >= uint32(len(ordinals)) || ordinals[pair.FirstSeenOrdinal] {
			return ErrInvalidInput
		}
		if i > 0 {
			previous := counts.Pairs[i-1]
			if previous.A > pair.A || previous.A == pair.A && previous.B >= pair.B {
				return ErrInvalidInput
			}
		}
		ordinals[pair.FirstSeenOrdinal] = true
	}
	return nil
}
