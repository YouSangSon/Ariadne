package application

import "testing"

func TestEnvironmentMetadataNeverQualifiesExecution(t *testing.T) {
	for _, tc := range []struct{ name, info, status string }{
		{"rootful", `{"host":{"os":"linux","arch":"arm64","cgroupVersion":"v2","security":{"rootless":false,"seccompEnabled":true}}}`, "unsupported"},
		{"candidate", `{"host":{"os":"linux","arch":"arm64","cgroupVersion":"v2","security":{"rootless":true,"seccompEnabled":true}}}`, "qualification-required"},
		{"missing", `{}`, "unsupported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := AssessEnvironment([]byte(tc.info))
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.status || got.RuntimeQualified || len(got.Reasons) == 0 {
				t.Fatalf("metadata was overstated: %+v", got)
			}
		})
	}
	if _, err := AssessEnvironment([]byte(`{"host":`)); err == nil {
		t.Fatal("malformed metadata accepted")
	}
}
