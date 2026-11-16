package domain

import (
	"reflect"
	"testing"
)

func TestCountReferenceLiteralFirstSeen(t *testing.T) {
	input := CoChangeInput{FileCount: 3, Commits: [][]uint32{{1, 2}, {0, 1}}}
	got, err := CountReference(input)
	want := CoChangeCounts{Frequencies: []uint32{1, 2, 1}, Pairs: []PairCount{{0, 1, 1, 1}, {1, 2, 1, 0}}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("counts=%+v error=%v; want %+v", got, err, want)
	}
}

func TestInputAndCountsBoundaries(t *testing.T) {
	for _, input := range []CoChangeInput{
		{FileCount: 1, Commits: [][]uint32{{1}}},
		{FileCount: 2, Commits: [][]uint32{{1, 0}}},
		{FileCount: 2, Commits: [][]uint32{{0, 0}}},
		{FileCount: MaxFiles + 1},
		{Commits: make([][]uint32, MaxCommits+1)},
		{FileCount: 26, Commits: [][]uint32{make([]uint32, 26)}},
	} {
		if _, err := CountReference(input); err == nil {
			t.Fatalf("accepted %+v", input)
		}
	}
	input := CoChangeInput{FileCount: 3, Commits: [][]uint32{{1, 2}, {0, 1}}}
	valid, _ := CountReference(input)
	for _, change := range []func(*CoChangeCounts){
		func(c *CoChangeCounts) { c.Frequencies = c.Frequencies[:2] },
		func(c *CoChangeCounts) { c.Frequencies[0] = 3 },
		func(c *CoChangeCounts) { c.Pairs[0].Count = 0 },
		func(c *CoChangeCounts) { c.Pairs[0].Count = 2 },
		func(c *CoChangeCounts) { c.Pairs[0].B = 3 },
		func(c *CoChangeCounts) { c.Pairs[0].A = c.Pairs[0].B },
		func(c *CoChangeCounts) { c.Pairs[0].FirstSeenOrdinal = 0 },
		func(c *CoChangeCounts) { c.Pairs[0].FirstSeenOrdinal = 2 },
		func(c *CoChangeCounts) { c.Pairs[0], c.Pairs[1] = c.Pairs[1], c.Pairs[0] },
	} {
		counts := CoChangeCounts{Frequencies: append([]uint32{}, valid.Frequencies...), Pairs: append([]PairCount{}, valid.Pairs...)}
		change(&counts)
		if ValidateCounts(input, counts) == nil {
			t.Fatalf("accepted %+v", counts)
		}
	}
}

func TestMaximumDisjointPairs(t *testing.T) {
	input := CoChangeInput{FileCount: MaxFiles, Commits: make([][]uint32, MaxCommits)}
	for i := range input.Commits {
		for j := 0; j < MaxFilesPerCommit; j++ {
			input.Commits[i] = append(input.Commits[i], uint32(i*MaxFilesPerCommit+j))
		}
	}
	counts, err := CountReference(input)
	if err != nil || len(counts.Pairs) != MaxPairs {
		t.Fatalf("pairs=%d error=%v", len(counts.Pairs), err)
	}
	for _, frequency := range counts.Frequencies {
		if frequency != 1 {
			t.Fatal(frequency)
		}
	}
	if err := ValidateCounts(input, counts); err != nil {
		t.Fatal(err)
	}
	counts.Pairs = append(counts.Pairs, PairCount{})
	if ValidateCounts(input, counts) != ErrLimitExceeded {
		t.Fatal("pair limit not enforced")
	}
}

func TestEmptyAndSingletons(t *testing.T) {
	for _, input := range []CoChangeInput{{}, {FileCount: 2, Commits: [][]uint32{{0}, {0}, {1}, {}}}} {
		counts, err := CountReference(input)
		if err != nil || len(counts.Pairs) != 0 || counts.Frequencies == nil || counts.Pairs == nil {
			t.Fatalf("%+v %v", counts, err)
		}
		if err := ValidateCounts(input, counts); err != nil {
			t.Fatal(err)
		}
	}
}
