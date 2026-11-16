package scrub_test

import (
	"ariadne/runtime/internal/core/domain/scrub"
	"encoding/json"
	"os"
	"reflect"
	"sync"
	"testing"
)

func TestNodeScrubCorpus(t *testing.T) {
	data, err := os.ReadFile("../../../../../../contracts/ontology/unicode-17/scrub-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Input, Text []uint16
			Detections  []string
		}
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != 27 {
		t.Fatal("expected 27 characterized cases")
	}
	for i, v := range fixture.Cases {
		got := scrub.Scrub(v.Input)
		if !reflect.DeepEqual(got.Text, v.Text) || !reflect.DeepEqual(got.Detections, v.Detections) {
			t.Errorf("case %d text units %x want %x, categories %v want %v", i, got.Text, v.Text, got.Detections, v.Detections)
		}
	}
}
func TestConcurrentScrubPreservesUnits(t *testing.T) {
	input := []uint16{0xd800, 0xd83d, 0xde00, 'x', 0xdfff}
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			for range 10 {
				got := scrub.Scrub(input)
				if !reflect.DeepEqual(got.Text, input) || len(got.Detections) != 0 {
					t.Error(got)
				}
			}
		})
	}
	group.Wait()
}
