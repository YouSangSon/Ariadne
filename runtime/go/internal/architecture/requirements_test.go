package architecture

import (
	"strings"
	"testing"
)

func TestRequirementsRequirementPolicyIsExact(t *testing.T) {
	for _, tt := range []struct {
		from, layer, owner, to, targetOwner, targetLayer string
		public, allowed                                  bool
	}{
		{"core/adapters/files", "infrastructure", "core", "platform/nodepath", "platform", "infrastructure", false, true},
		{"requirements/adapters/files", "infrastructure", "requirements", "platform/nodepath", "platform", "infrastructure", false, true},
		{"requirements/application", "application", "requirements", "platform/nodepath", "platform", "infrastructure", false, false},
		{"context/adapters/files", "infrastructure", "context", "platform/nodepath", "platform", "infrastructure", false, false},
		{"requirements/adapters/files", "infrastructure", "requirements", "platform/computeprocess", "platform", "infrastructure", false, false},
		{"requirements/domain", "domain", "requirements", "core/domain/requirementfields", "shared", "domain", false, true},
		{"requirements/application", "application", "requirements", "core/domain/requirementfields", "shared", "domain", false, false},
		{"requirements/domain/nested", "domain", "requirements", "core/domain/requirementfields", "shared", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "core/domain/requirementfields/nested", "shared", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "core/domain/other", "shared", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "core/domain/requirementfields", "core", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "core/domain/requirementfields", "shared", "application", true, false},
		{"requirements/domain", "domain", "requirements", "core/domain/requirementfields", "shared", "domain", true, false},
		{"other/domain", "domain", "other", "core/domain/requirementfields", "shared", "domain", false, false},
		{"requirements/domain", "domain", "other", "core/domain/requirementfields", "shared", "domain", false, false},
		{"core/domain/requirementfields", "domain", "shared", "requirements/domain", "requirements", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "ontology/domain", "ontology", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "context/domain", "context", "domain", false, false},
		{"requirements/domain", "application", "requirements", "core/domain/requirementfields", "shared", "domain", false, false},
		{"requirements/domain", "domain", "requirements", "requirements/adapters/files", "requirements", "infrastructure", false, false},
		{"requirements/domain", "domain", "requirements", "other/application", "other", "application", true, false},
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
func TestRequirementsRequirementPolicyRejectsReverseCycle(t *testing.T) {
	from, to := "internal/requirements/domain/a.go", "internal/core/domain/requirementfields/b.go"
	violations, err := Check(fixture(t, map[string]string{from: "package source\nimport _ \"example.test/runtime/internal/core/domain/requirementfields\"", to: "package target\nimport _ \"example.test/runtime/internal/requirements/domain\""}, map[string]Record{from: {Layer: "domain", Context: "requirements"}, to: {Layer: "domain", Context: "shared"}}))
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
func TestRequirementsInwardOSRemainsRejected(t *testing.T) {
	for _, layer := range []string{"domain", "application"} {
		name := "internal/requirements/" + layer + "/a.go"
		violations, err := Check(fixture(t, map[string]string{name: "package source\nimport _ \"os\""}, map[string]Record{name: {Layer: layer, Context: "requirements"}}))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(strings.Join(violations, "\n"), "inward layer imports platform/package os") {
			t.Fatal(violations)
		}
	}
}
