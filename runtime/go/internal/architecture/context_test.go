package architecture

import (
	"strings"
	"testing"
)

func TestContextRequirementPolicyIsExact(t *testing.T) {
	for _, tt := range []struct {
		from, layer, owner, to, targetOwner, targetLayer string
		public, allowed                                  bool
	}{
		{"context/domain", "domain", "context", "core/domain/requirementfields", "shared", "domain", false, true},
		{"context/application", "application", "context", "core/domain/requirementfields", "shared", "domain", false, false},
		{"context/domain/nested", "domain", "context", "core/domain/requirementfields", "shared", "domain", false, false},
		{"context/domain", "domain", "context", "core/domain/requirementfields/nested", "shared", "domain", false, false},
		{"context/domain", "domain", "context", "core/domain/other", "shared", "domain", false, false},
		{"context/domain", "domain", "context", "core/domain/requirementfields", "core", "domain", false, false},
		{"context/domain", "domain", "context", "core/domain/requirementfields", "shared", "application", true, false},
		{"context/domain", "domain", "context", "core/domain/requirementfields", "shared", "domain", true, false},
		{"other/domain", "domain", "other", "core/domain/requirementfields", "shared", "domain", false, false},
		{"context/domain", "domain", "other", "core/domain/requirementfields", "shared", "domain", false, false},
		{"core/domain/requirementfields", "domain", "shared", "context/domain", "context", "domain", false, false},
		{"context/domain", "domain", "context", "ontology/domain", "ontology", "domain", false, false},
		{"context/domain", "domain", "context", "context/adapters/files", "context", "infrastructure", false, false},
		{"context/domain", "domain", "context", "other/application", "other", "application", true, false},
	} {
		t.Run(tt.from+"->"+tt.to+"/"+tt.targetOwner+"/"+tt.targetLayer, func(t *testing.T) {
			from, to := "internal/"+tt.from+"/a.go", "internal/"+tt.to+"/b.go"
			violations, err := Check(fixture(t, map[string]string{from: "package source\nimport _ \"example.test/runtime/internal/" + tt.to + "\"", to: "package target"}, map[string]Record{from: {Layer: tt.layer, Context: tt.owner}, to: {Layer: tt.targetLayer, Context: tt.targetOwner, Public: tt.public}}))
			if err != nil {
				t.Fatal(err)
			}
			if tt.allowed && len(violations) != 0 || !tt.allowed && len(violations) == 0 {
				t.Fatalf("allowed=%v violations=%v", tt.allowed, violations)
			}
		})
	}
}
func TestContextRequirementPolicyRejectsReverseCycle(t *testing.T) {
	from, to := "internal/context/domain/a.go", "internal/core/domain/requirementfields/b.go"
	violations, err := Check(fixture(t, map[string]string{from: "package source\nimport _ \"example.test/runtime/internal/core/domain/requirementfields\"", to: "package target\nimport _ \"example.test/runtime/internal/context/domain\""}, map[string]Record{from: {Layer: "domain", Context: "context"}, to: {Layer: "domain", Context: "shared"}}))
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(violations, "\n")
	for _, want := range []string{"cross-context internal dependency", "module context cycle", "import cycle"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %s: %v", want, violations)
		}
	}
}
func TestContextInwardOSRemainsRejected(t *testing.T) {
	for _, layer := range []string{"domain", "application"} {
		name := "internal/context/" + layer + "/a.go"
		violations, err := Check(fixture(t, map[string]string{name: "package source\nimport _ \"os\""}, map[string]Record{name: {Layer: layer, Context: "context"}}))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(strings.Join(violations, "\n"), "inward layer imports platform/package os") {
			t.Fatal(violations)
		}
	}
}
