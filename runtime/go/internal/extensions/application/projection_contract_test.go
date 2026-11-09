package application

import (
	"ariadne/runtime/internal/extensions/domain"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtureRoot = "../../../../../contracts/extensions/v1/fixtures"

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, e := os.ReadFile(filepath.Join(fixtureRoot, name))
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestProjectionFixtures(t *testing.T) {
	var cases []struct {
		File, Kind string
		Valid      bool
	}
	if e := json.Unmarshal(readFixture(t, "cases.json"), &cases); e != nil {
		t.Fatal(e)
	}
	input, e := ParseProjectionInput(readFixture(t, "input-unknown.json"))
	if e != nil {
		t.Fatal(e)
	}
	for _, c := range cases {
		if c.Kind == "manifest" {
			continue
		}
		t.Run(c.File, func(t *testing.T) {
			data := readFixture(t, c.File)
			var e error
			if c.Kind == "input" {
				_, e = ParseProjectionInput(data)
			} else {
				_, e = ParseProjectionOutput(data, input)
			}
			if (e == nil) != c.Valid {
				t.Fatalf("valid=%v error=%v", c.Valid, e)
			}
		})
	}
}
func TestProjectionByteLimits(t *testing.T) {
	inputData := readFixture(t, "input-unknown.json")
	input, e := ParseProjectionInput(inputData)
	if e != nil {
		t.Fatal(e)
	}
	for _, c := range []struct {
		name  string
		limit int
	}{{"input-unknown.json", domain.MaxInputBytes}, {"output-valid.json", domain.MaxOutputBytes}} {
		t.Run(c.name, func(t *testing.T) {
			data := readFixture(t, c.name)
			data = append(data, []byte(strings.Repeat(" ", c.limit-len(data)))...)
			parse := func(data []byte) error {
				if c.name == "input-unknown.json" {
					_, e := ParseProjectionInput(data)
					return e
				}
				_, e := ParseProjectionOutput(data, input)
				return e
			}
			if e := parse(data); e != nil {
				t.Fatalf("exact limit: %v", e)
			}
			if e := parse(append(data, ' ')); e == nil {
				t.Fatal("accepted above byte limit")
			}
		})
	}
}
func TestProjectionTypedValidation(t *testing.T) {
	input, e := ParseProjectionInput(readFixture(t, "input-unknown.json"))
	if e != nil {
		t.Fatal(e)
	}
	if input.Comparison.Base.CostUSD.Status != "unknown" || input.Comparison.Base.CostUSD.Value != nil {
		t.Fatal("unknown became known")
	}
	input.Comparison.Base.CostUSD.Status = "verified"
	if e := ValidateProjectionInput(input); e == nil {
		t.Fatal("accepted unsupported typed status")
	}
}

func TestProjectionExactLimits(t *testing.T) {
	input, e := ParseProjectionInput(readFixture(t, "input-unknown.json"))
	if e != nil {
		t.Fatal(e)
	}
	output, e := ParseProjectionOutput(readFixture(t, "output-valid.json"), input)
	if e != nil {
		t.Fatal(e)
	}
	section := output.Sections[0]
	section.Body = strings.Repeat("x", domain.MaxStringBytes)
	section.Table = nil
	output.Sections = make([]Section, domain.MaxSections)
	for i := range output.Sections {
		output.Sections[i] = section
	}
	// Keep aggregate JSON below its independent byte limit while reaching 32 sections.
	for i := 1; i < len(output.Sections); i++ {
		output.Sections[i].Body = ""
	}
	if e := ValidateProjectionOutput(output, input); e != nil {
		t.Fatalf("exact section/string limits: %v", e)
	}
	output.Sections = []Section{{Title: "Table", Body: "", SourceIDs: []string{input.SourceID}, Table: &Table{Columns: []string{"value"}, Rows: make([][]string, domain.MaxTableCells-1)}}}
	for i := range output.Sections[0].Table.Rows {
		output.Sections[0].Table.Rows[i] = []string{"1"}
	}
	if e := ValidateProjectionOutput(output, input); e != nil {
		t.Fatalf("exact cells: %v", e)
	}
	output.Sections[0].Table.Rows = append(output.Sections[0].Table.Rows, []string{"2"})
	if e := ValidateProjectionOutput(output, input); e == nil {
		t.Fatal("accepted cells beyond aggregate limit")
	}
	output.Sections = []Section{{Title: "Unicode", Body: strings.Repeat("한", 2730) + "ab", SourceIDs: []string{input.SourceID}}}
	if e := ValidateProjectionOutput(output, input); e != nil {
		t.Fatalf("exact Unicode byte limit: %v", e)
	}
	output.Sections[0].Body += "c"
	if e := ValidateProjectionOutput(output, input); e == nil {
		t.Fatal("accepted Unicode byte overflow")
	}
	input.Comparison.Base.CostUSD = Metric{Status: "known", Value: new(float64)}
	*input.Comparison.Base.CostUSD.Value = math.Inf(1)
	if e := ValidateProjectionInput(input); e == nil {
		t.Fatal("accepted non-finite typed cost")
	}
}

func TestTokenPrecision(t *testing.T) {
	data := string(readFixture(t, "input-unknown.json"))
	for _, value := range []string{"0", "1.0", "1e0", "100e-2", "9007199254740991"} {
		changed := strings.Replace(data, `"value": 1200`, `"value": `+value, 1)
		got, err := ParseProjectionInput([]byte(changed))
		if err != nil {
			t.Fatalf("valid exact token representation %s: %v", value, err)
		}
		if got.Comparison.Selected.TotalTokens.Value == nil {
			t.Fatal("known token value disappeared")
		}
	}
	for _, value := range []string{"1.000000000000000000001", "9007199254740991.1", "9007199254740992"} {
		changed := strings.Replace(data, `"value": 1200`, `"value": `+value, 1)
		if _, err := ParseProjectionInput([]byte(changed)); err == nil {
			t.Fatalf("accepted fractional token count %s after float rounding", value)
		}
	}
}
