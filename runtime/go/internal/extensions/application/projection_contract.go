package application

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"unicode/utf8"

	"ariadne/runtime/internal/extensions/domain"
)

const ProjectionWorld = domain.World

type Metric struct {
	Status string   `json:"status"`
	Value  *float64 `json:"value,omitempty"`
}

type TokenMetric struct {
	Status string `json:"status"`
	Value  *int64 `json:"value,omitempty"`
}

type Summary struct {
	ReportedPasses int64       `json:"reportedPasses"`
	TotalTokens    TokenMetric `json:"totalTokens"`
	CostUSD        Metric      `json:"costUSD"`
}

type Comparison struct {
	Status   string  `json:"status"`
	Base     Summary `json:"base"`
	Selected Summary `json:"selected"`
}

type ProjectionInput struct {
	SchemaVersion int        `json:"schemaVersion"`
	SourceID      string     `json:"sourceId"`
	SourceDigest  string     `json:"sourceDigest"`
	Comparison    Comparison `json:"comparison"`
}

type Table struct {
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"rows"`
}

type Section struct {
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	SourceIDs []string `json:"sourceIds"`
	Table     *Table   `json:"table,omitempty"`
}

type ProjectionOutput struct {
	SchemaVersion int       `json:"schemaVersion"`
	Sections      []Section `json:"sections"`
}

var sourceIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

const maxSafeInteger = 9007199254740991

func ParseProjectionInput(data []byte) (ProjectionInput, error) {
	var input ProjectionInput
	if err := domain.DecodeStrictJSON(data, domain.MaxInputBytes, &input); err != nil {
		return ProjectionInput{}, err
	}
	if err := ValidateProjectionInput(input); err != nil {
		return ProjectionInput{}, err
	}
	return input, nil
}

func ParseProjectionOutput(data []byte, input ProjectionInput) (ProjectionOutput, error) {
	var output ProjectionOutput
	if err := domain.DecodeStrictJSON(data, domain.MaxOutputBytes, &output); err != nil {
		return ProjectionOutput{}, err
	}
	if err := ValidateProjectionOutput(output, input); err != nil {
		return ProjectionOutput{}, err
	}
	return output, nil
}

func ValidateProjectionInput(input ProjectionInput) error {
	if input.SchemaVersion != 1 || len(input.SourceID) > 128 || !sourceIDPattern.MatchString(input.SourceID) || !digestPattern.MatchString(input.SourceDigest) {
		return errors.New("invalid projection source or schema version")
	}
	if input.Comparison.Status != "comparable" && input.Comparison.Status != "descriptive-only" {
		return errors.New("invalid comparison status")
	}
	for _, summary := range []Summary{input.Comparison.Base, input.Comparison.Selected} {
		if summary.ReportedPasses < 0 || summary.ReportedPasses > maxSafeInteger {
			return errors.New("invalid reported pass count")
		}
		if err := validateMetricStatus(summary.TotalTokens.Status, summary.TotalTokens.Value != nil); err != nil {
			return err
		}
		if value := summary.TotalTokens.Value; value != nil && (*value < 0 || *value > maxSafeInteger) {
			return errors.New("invalid token count")
		}
		if err := validateMetricStatus(summary.CostUSD.Status, summary.CostUSD.Value != nil); err != nil {
			return err
		}
		if pointer := summary.CostUSD.Value; pointer != nil {
			value := *pointer
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
				return errors.New("invalid cost value")
			}
		}
	}
	data, err := json.Marshal(input)
	if err != nil || len(data) > domain.MaxInputBytes {
		return errors.New("projection input byte limit exceeded")
	}
	return nil
}

func validateMetricStatus(status string, hasValue bool) error {
	if (status == "unknown" && !hasValue) || (status == "known" && hasValue) {
		return nil
	}
	return errors.New("metric status and value must agree")
}

func ValidateProjectionOutput(output ProjectionOutput, input ProjectionInput) error {
	if err := ValidateProjectionInput(input); err != nil {
		return err
	}
	if output.SchemaVersion != 1 || len(output.Sections) == 0 || len(output.Sections) > domain.MaxSections {
		return errors.New("invalid output schema or section count")
	}
	cells := 0
	for _, section := range output.Sections {
		if section.Title == "" || !plainText(section.Title) || !plainText(section.Body) {
			return errors.New("invalid section text")
		}
		if len(section.SourceIDs) != 1 || section.SourceIDs[0] != input.SourceID {
			return errors.New("output source reference not in input")
		}
		if section.Table == nil {
			continue
		}
		table := section.Table
		if len(table.Columns) == 0 || table.Rows == nil {
			return errors.New("table requires columns and rows")
		}
		cells += len(table.Columns)
		if cells > domain.MaxTableCells {
			return errors.New("table cell limit exceeded")
		}
		for _, column := range table.Columns {
			if !plainText(column) {
				return errors.New("invalid table text")
			}
		}
		for _, row := range table.Rows {
			if len(row) != len(table.Columns) {
				return errors.New("table rows must match columns")
			}
			cells += len(row)
			if cells > domain.MaxTableCells {
				return errors.New("table cell limit exceeded")
			}
			for _, cell := range row {
				if !plainText(cell) {
					return errors.New("invalid table text")
				}
			}
		}
	}
	data, err := json.Marshal(output)
	if err != nil || len(data) > domain.MaxOutputBytes {
		return errors.New("projection output byte limit exceeded")
	}
	return nil
}

func plainText(value string) bool {
	if !utf8.ValidString(value) || len(value) > domain.MaxStringBytes {
		return false
	}
	for _, r := range value {
		if r == 127 || (r < 32 && r != '\t' && r != '\n' && r != '\r') {
			return false
		}
	}
	return true
}
