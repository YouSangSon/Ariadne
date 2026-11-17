//go:build darwin || linux

package ontologyfiles

import (
	corefiles "ariadne/runtime/internal/core/adapters/files"
	ontologyapp "ariadne/runtime/internal/ontology/application"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestSelfAndHardlinkAlias(t *testing.T) {
	for _, source := range []string{"ontology.json", "alias.json"} {
		t.Run(source, func(t *testing.T) {
			root := t.TempDir()
			manifest := filepath.Join(root, "ontology.json")
			data := `{"schema_version":1,"terms":[{"id":"a","name":"A","description":"test","synonyms":[],"sources":["` + source + `"]}],"relations":[]}`
			if err := os.WriteFile(manifest, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			if source == "alias.json" {
				if err := os.Link(manifest, filepath.Join(root, source)); err != nil {
					t.Fatal(err)
				}
			}
			ports, err := New(manifest, corefiles.Reader{})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = ontologyapp.LoadOntology(ports); err == nil || err.Error() != "Ontology manifest cannot be its own source" {
				t.Fatal(err)
			}
		})
	}
}
