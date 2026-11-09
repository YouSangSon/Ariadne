package application

import (
	extensions "ariadne/runtime/internal/extensions/application"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestProjectReport(t *testing.T) {
	data, e := os.ReadFile("../../../../../contracts/extensions/v1/fixtures/input-unknown.json")
	if e != nil {
		t.Fatal(e)
	}
	input, e := extensions.ParseProjectionInput(data)
	if e != nil {
		t.Fatal(e)
	}
	before, _ := json.Marshal(input)
	output, e := ProjectReport(input)
	if e != nil {
		t.Fatal(e)
	}
	if e := extensions.ValidateProjectionOutput(output, input); e != nil {
		t.Fatal(e)
	}
	if len(output.Sections) != 2 || output.Sections[0].Title != "Reported comparison" || !strings.Contains(output.Sections[0].Body, "descriptive-only") {
		t.Fatalf("missing descriptive structure: %+v", output)
	}
	table := output.Sections[1].Table
	want := [][]string{{"base", "2", "unknown", "unknown"}, {"selected", "1", "1200", "0.04"}}
	if table == nil || !reflect.DeepEqual(table.Rows, want) {
		t.Fatalf("reported values/unknown not preserved: %+v", table)
	}
	again, e := ProjectReport(input)
	if e != nil || !reflect.DeepEqual(again, output) {
		t.Fatal("projection is not deterministic")
	}
	after, _ := json.Marshal(input)
	if string(before) != string(after) {
		t.Fatal("source input changed")
	}
	input.Comparison.Status = "verified"
	if _, e := ProjectReport(input); e == nil {
		t.Fatal("projected invalid input")
	}
}
func TestBuiltinDescriptor(t *testing.T) {
	got := BuiltinDescriptor()
	if got.ExtensionID != "ariadne/builtin-report" || got.Version != "1.0.0" || got.Runtime != "builtin" || got.World != "ariadne:extensions/report-projector@1.0.0" {
		t.Fatalf("descriptor identity: %+v", got)
	}
	data, e := json.Marshal(got)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(data), "artifactSha256") {
		t.Fatal("builtin fabricated a WASM artifact digest")
	}
}
