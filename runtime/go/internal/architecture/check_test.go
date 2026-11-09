package architecture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T, sources map[string]string, records map[string]Record) string {
	t.Helper()
	root := t.TempDir()
	sources["go.mod"] = "module example.test/runtime\n\ngo 1.24.5\n"
	for path, source := range sources {
		path = filepath.Join(root, "runtime/go", path)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(source), 0600); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]Record{}
	for path, record := range records {
		files["runtime/go/"+path] = record
	}
	data, err := json.Marshal(struct {
		Version int               `json:"schema_version"`
		Files   map[string]Record `json:"files"`
	}{1, files})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "architecture-map.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestCheckBoundaries(t *testing.T) {
	domain := Record{Layer: "domain", Context: "one"}
	application := Record{Layer: "application", Context: "one"}
	for _, tt := range []struct {
		name    string
		sources map[string]string
		records map[string]Record
		want    string
	}{
		{"pure imports and AST literals", map[string]string{"internal/one/domain/value.go": "package domain\n// import \"os\"\nimport ( alias `encoding/json`; _ \"crypto/sha256\"; _ \"bytes\"; _ \"errors\"; _ \"fmt\"; _ \"strings\"; _ \"unicode\"; _ \"regexp\"; _ \"math\"; _ \"sort\"; _ \"strconv\" )\nvar _ = alias.Valid\n"}, map[string]Record{"internal/one/domain/value.go": domain}, ""},
		{"domain outward", map[string]string{"internal/one/domain/value.go": "package domain\nimport _ \"example.test/runtime/internal/one/application\"", "internal/one/application/use.go": "package application"}, map[string]Record{"internal/one/domain/value.go": domain, "internal/one/application/use.go": application}, "domain depends outward"},
		{"application adapter", map[string]string{"internal/one/application/use.go": "package application\nimport _ \"example.test/runtime/internal/one/adapters\"", "internal/one/adapters/file.go": "package adapters"}, map[string]Record{"internal/one/application/use.go": application, "internal/one/adapters/file.go": {Layer: "infrastructure", Context: "one"}}, "application depends outward"},
		{"context internals", map[string]string{"internal/one/application/use.go": "package application\nimport _ \"example.test/runtime/internal/two/domain\"", "internal/two/domain/value.go": "package domain"}, map[string]Record{"internal/one/application/use.go": application, "internal/two/domain/value.go": {Layer: "domain", Context: "two"}}, "cross-context internal dependency"},
		{"public application contract", map[string]string{"internal/one/application/use.go": "package application\nimport _ \"example.test/runtime/internal/two/application\"", "internal/two/application/contract.go": "package application"}, map[string]Record{"internal/one/application/use.go": application, "internal/two/application/contract.go": {Layer: "application", Context: "two", Public: true}}, ""},
		{"public application package", map[string]string{"internal/one/application/use.go": "package application\nimport _ \"example.test/runtime/internal/two/application\"", "internal/two/application/a.go": "package application", "internal/two/application/contract.go": "package application"}, map[string]Record{"internal/one/application/use.go": application, "internal/two/application/a.go": {Layer: "application", Context: "two"}, "internal/two/application/contract.go": {Layer: "application", Context: "two", Public: true}}, ""},
		{"domain cannot be public", map[string]string{"internal/one/domain/value.go": "package domain"}, map[string]Record{"internal/one/domain/value.go": {Layer: "domain", Context: "one", Public: true}}, "invalid ownership"},
		{"inconsistent package", map[string]string{"internal/one/domain/a.go": "package domain", "internal/one/domain/b.go": "package domain"}, map[string]Record{"internal/one/domain/a.go": domain, "internal/one/domain/b.go": {Layer: "domain", Context: "two"}}, "inconsistent package ownership"},
		{"unowned source", map[string]string{"internal/one/domain/value.go": "package domain"}, nil, "unowned source runtime/go/internal/one/domain/value.go"},
		{"unowned test", map[string]string{"internal/one/domain/value_test.go": "package domain"}, nil, "unowned source runtime/go/internal/one/domain/value_test.go"},
		{"tooling test I/O", map[string]string{"internal/one/domain/value_test.go": "package domain\nimport _ \"os\""}, map[string]Record{"internal/one/domain/value_test.go": {Layer: "tooling", Context: "validation"}}, ""},
		{"external test imports package", map[string]string{"internal/one/domain/value.go": "package domain", "internal/one/domain/value_test.go": "package domain_test\nimport _ \"example.test/runtime/internal/one/domain\""}, map[string]Record{"internal/one/domain/value.go": domain, "internal/one/domain/value_test.go": {Layer: "tooling", Context: "validation"}}, ""},
		{"misclassified domain", map[string]string{"internal/one/domain/value.go": "package domain\nimport _ \"os\""}, map[string]Record{"internal/one/domain/value.go": {Layer: "tooling", Context: "one"}}, "incorrect layer classification"},
		{"stale ownership", map[string]string{}, map[string]Record{"internal/one/domain/missing.go": domain}, "stale ownership"},
		{"local cycle", map[string]string{"internal/one/domain/a.go": "package domain\nimport _ \"example.test/runtime/internal/one/domain/values\"", "internal/one/domain/values/b.go": "package values\nimport _ \"example.test/runtime/internal/one/domain\""}, map[string]Record{"internal/one/domain/a.go": domain, "internal/one/domain/values/b.go": domain}, "import cycle"},
		{"unresolved local import", map[string]string{"internal/one/domain/a.go": "package domain\nimport _ \"example.test/runtime/internal/one/domain/missing\""}, map[string]Record{"internal/one/domain/a.go": domain}, "unowned local dependency"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			errors, err := Check(fixture(t, tt.sources, tt.records))
			if err != nil {
				t.Fatal(err)
			}
			got := strings.Join(errors, "\n")
			if tt.want == "" && got != "" || tt.want != "" && !strings.Contains(got, tt.want) {
				t.Fatalf("want %q, got %q", tt.want, got)
			}
		})
	}
}

func TestRejectInwardPlatformAndThirdPartyImports(t *testing.T) {
	for _, layer := range []string{"domain", "application"} {
		for _, dependency := range []string{"os", "net", "net/http", "database/sql", "os/exec", "syscall", "unsafe", "C", "crypto/rand", "example.test/sdk"} {
			t.Run(layer+"/"+dependency, func(t *testing.T) {
				path := "internal/one/" + layer + "/value.go"
				root := fixture(t, map[string]string{path: "package value\nimport _ \"" + dependency + "\""}, map[string]Record{path: {Layer: layer, Context: "one"}})
				errors, err := Check(root)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(strings.Join(errors, "\n"), "inward layer imports platform/package "+dependency) {
					t.Fatalf("import %s accepted: %v", dependency, errors)
				}
			})
		}
	}
}

func TestModuleCyclesAndComposition(t *testing.T) {
	for _, tt := range []struct {
		name       string
		entryLayer string
		want       string
	}{
		{"package DAG still has module cycle", "application", "module context cycle"},
		{"composition assembles modules", "composition", ""},
		{"tooling does not create module cycle", "tooling", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			entry := "internal/one/" + tt.entryLayer + "/use/use.go"
			sources := map[string]string{
				entry: "package use\nimport _ \"example.test/runtime/internal/two/application/contract\"",
				"internal/one/application/contract/contract.go": "package contract",
				"internal/two/application/use/use.go":           "package use\nimport _ \"example.test/runtime/internal/one/application/contract\"",
				"internal/two/application/contract/contract.go": "package contract",
			}
			records := map[string]Record{
				entry: {Layer: tt.entryLayer, Context: "one"},
				"internal/one/application/contract/contract.go": {Layer: "application", Context: "one", Public: true},
				"internal/two/application/use/use.go":           {Layer: "application", Context: "two"},
				"internal/two/application/contract/contract.go": {Layer: "application", Context: "two", Public: true},
			}
			if tt.entryLayer == "composition" {
				sources[entry] += "\nimport _ \"example.test/runtime/internal/two/adapters/files\""
				sources["internal/two/adapters/files/files.go"] = "package files"
				records["internal/two/adapters/files/files.go"] = Record{Layer: "infrastructure", Context: "two"}
			}
			violations, err := Check(fixture(t, sources, records))
			if err != nil {
				t.Fatal(err)
			}
			got := strings.Join(violations, "\n")
			if tt.want == "" && got != "" || tt.want != "" && !strings.Contains(got, tt.want) {
				t.Fatalf("want %q, got %q", tt.want, got)
			}
			if strings.Contains(got, "import cycle") {
				t.Fatalf("fixture must remain a package DAG: %s", got)
			}
		})
	}
}
