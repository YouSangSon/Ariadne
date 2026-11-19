package architecture

import (
	"strings"
	"testing"
)

func TestCoreVerificationBoundaries(t *testing.T) {
	for _, tt := range []struct {
		name, from, layer, dependency, target, targetLayer, targetContext, want string
	}{
		{name: "domain OS access", from: "internal/core/domain/verification/commit.go", layer: "domain", dependency: "os", want: "inward layer imports platform/package os"},
		{name: "domain process access", from: "internal/core/domain/verification/commit.go", layer: "domain", dependency: "os/exec", want: "inward layer imports platform/package os/exec"},
		{name: "application adapter", from: "internal/core/application/verification/verification.go", layer: "application", dependency: "example.test/runtime/internal/core/adapters/files", target: "internal/core/adapters/files/files.go", targetLayer: "infrastructure", targetContext: "core", want: "application depends outward"},
		{name: "domain crosses context", from: "internal/core/domain/verification/commit.go", layer: "domain", dependency: "example.test/runtime/internal/ontology/domain", target: "internal/ontology/domain/value.go", targetLayer: "domain", targetContext: "ontology", want: "cross-context internal dependency"},
		{name: "application consumes verification policy", from: "internal/core/application/verification/verification.go", layer: "application", dependency: "example.test/runtime/internal/core/domain/verification", target: "internal/core/domain/verification/commit.go", targetLayer: "domain", targetContext: "core"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			sources := map[string]string{tt.from: "package verification\nimport _ \"" + tt.dependency + "\""}
			records := map[string]Record{tt.from: {Layer: tt.layer, Context: "core"}}
			if tt.target != "" {
				sources[tt.target] = "package target"
				records[tt.target] = Record{Layer: tt.targetLayer, Context: tt.targetContext}
			}
			violations, err := Check(fixture(t, sources, records))
			if err != nil {
				t.Fatal(err)
			}
			got := strings.Join(violations, "\n")
			if tt.want == "" && got != "" || tt.want != "" && !strings.Contains(got, tt.want) {
				t.Fatalf("want %q, got %q", tt.want, got)
			}
		})
	}
}
