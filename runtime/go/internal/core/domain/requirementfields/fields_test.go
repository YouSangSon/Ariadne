package requirementfields

import (
	"reflect"
	"testing"
)

func TestFieldBlockOwnsResultAndLeavesInputUnchanged(t *testing.T) {
	source := []uint16{'m', 'e', 't', 'a', 'd', 'a', 't', 'a', ':', 10, ' ', ' ', 'x', ':', ' ', 0xd800, 10}
	before := append([]uint16(nil), source...)
	got, err := FieldBlock(source, []string{"metadata"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source, before) {
		t.Fatal("input mutated")
	}
	got[0] = 'X'
	if !reflect.DeepEqual(source, before) {
		t.Fatal("result aliases source")
	}
	all, err := FieldBlock(source, nil)
	if err != nil {
		t.Fatal(err)
	}
	all[0] = 'Y'
	if source[0] != 'm' {
		t.Fatal("empty-path result aliases source")
	}
}
