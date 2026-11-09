package application

import (
	"strconv"

	extensions "ariadne/runtime/internal/extensions/application"
)

type Descriptor struct {
	ExtensionID string `json:"extensionId"`
	Version     string `json:"version"`
	World       string `json:"world"`
	Runtime     string `json:"runtime"`
}

func BuiltinDescriptor() Descriptor {
	return Descriptor{ExtensionID: "ariadne/builtin-report", Version: "1.0.0", World: extensions.ProjectionWorld, Runtime: "builtin"}
}

// ProjectReport adds a view of reported data; it never authenticates outcomes.
func ProjectReport(input extensions.ProjectionInput) (extensions.ProjectionOutput, error) {
	if err := extensions.ValidateProjectionInput(input); err != nil {
		return extensions.ProjectionOutput{}, err
	}
	rows := make([][]string, 0, 2)
	for _, variant := range []struct {
		name    string
		summary extensions.Summary
	}{{"base", input.Comparison.Base}, {"selected", input.Comparison.Selected}} {
		tokens := "unknown"
		if variant.summary.TotalTokens.Status == "known" {
			tokens = strconv.FormatInt(*variant.summary.TotalTokens.Value, 10)
		}
		rows = append(rows, []string{variant.name, strconv.FormatInt(variant.summary.ReportedPasses, 10), tokens, metricText(variant.summary.CostUSD)})
	}
	output := extensions.ProjectionOutput{SchemaVersion: 1, Sections: []extensions.Section{
		{Title: "Reported comparison", Body: "Comparison status: " + input.Comparison.Status + ". Derived display of reported data; outcomes and verifier receipts are not independently authenticated. Differences are descriptive, not causal or statistical proof.", SourceIDs: []string{input.SourceID}},
		{Title: "Reported totals", Body: "Unknown values remain unknown. Cost calculations use floating-point numbers and may contain rounding error.", SourceIDs: []string{input.SourceID}, Table: &extensions.Table{Columns: []string{"Variant", "Reported passes", "Total tokens", "Cost USD"}, Rows: rows}},
	}}
	if err := extensions.ValidateProjectionOutput(output, input); err != nil {
		return extensions.ProjectionOutput{}, err
	}
	return output, nil
}

func metricText(metric extensions.Metric) string {
	if metric.Status == "unknown" {
		return "unknown"
	}
	return strconv.FormatFloat(*metric.Value, 'f', -1, 64)
}
