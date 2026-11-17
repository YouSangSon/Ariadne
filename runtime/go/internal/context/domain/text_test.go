package domain

import (
	"reflect"
	"sync"
	"testing"
)

func TestTextCopiesAndReplacementOutput(t *testing.T) {
	original := []uint16{0xd800, 0xd83d, 0xde00, 0xdfff}
	text := NewText(original)
	original[0] = 'x'
	units := text.Units()
	units[3] = 'y'
	if !reflect.DeepEqual(text.Units(), []uint16{0xd800, 0xd83d, 0xde00, 0xdfff}) || text.Len() != 4 {
		t.Fatal("Text aliases caller memory", text.Units())
	}
	if text.String() != "\ufffd😀\ufffd" {
		t.Fatalf("output replacement: %q", text.String())
	}
	if !reflect.DeepEqual(FromString("😀").Units(), []uint16{0xd83d, 0xde00}) {
		t.Fatal("UTF-8 input boundary")
	}
}
func TestMetadataDecodedLonesAreNotReplaced(t *testing.T) {
	metadata, err := SkillMetadata("research", FromString("---\nname: research\ndescription: \"\\ud800x\\udfff\"\n---"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(metadata.Description.Units(), []uint16{0xd800, 'x', 0xdfff}) {
		t.Fatal(metadata.Description.Units())
	}
}
func TestPureCallsDoNotMutateSharedInputs(t *testing.T) {
	source := FromString("metadata:\n  req_id: demo\n  status: verified\nverification:\n  commands: [whole contract]\n")
	input := RenderInput{Requirement: source, Handoff: Handoff{State: FromString("first 😀\nsecond\nthird"), Constraints: FromString("whole constraint")}, Decisions: FromString("one\ntwo"), Budget: "brief"}
	before := source.Units()
	want, err := RenderPack(input)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for _, budget := range []string{"brief", "standard", "deep", "unknown"} {
		group.Add(1)
		go func(budget string) {
			defer group.Done()
			copy := input
			copy.Budget = budget
			if _, err := RenderPack(copy); err != nil {
				t.Error(err)
			}
			if status, err := RequirementStatus(source, "demo"); err != nil || status != "verified" {
				t.Error(status, err)
			}
		}(budget)
	}
	group.Wait()
	got, err := RenderPack(input)
	if err != nil || !got.equal(want) || !reflect.DeepEqual(source.Units(), before) {
		t.Fatal("input mutation", err)
	}
}
