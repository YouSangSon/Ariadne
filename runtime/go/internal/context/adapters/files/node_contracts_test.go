package contextfiles

import (
	contextapp "ariadne/runtime/internal/context/application"
	"ariadne/runtime/internal/context/domain"
	corefiles "ariadne/runtime/internal/core/adapters/files"
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type fixtureFile struct {
	Path, RawPathHex, Hex, Kind, Target, Prefix, FillHex string
	Size                                                 int
}
type fixtureCase struct {
	ID, Method, Arg string
	Files           []fixtureFile
	MissingRoot     bool `json:"missing_root"`
	ProbeRace       bool `json:"probe_race"`
}

func (f *fixtureFile) UnmarshalJSON(data []byte) error {
	type plain fixtureFile
	var v struct {
		plain
		RawPath string `json:"raw_path_hex"`
		Fill    string `json:"fill_hex"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*f = fixtureFile(v.plain)
	f.RawPathHex = v.RawPath
	f.FillHex = v.Fill
	return nil
}
func materialize(t *testing.T, root string, files []fixtureFile) {
	t.Helper()
	for _, f := range files {
		name := f.Path
		if f.RawPathHex != "" {
			b, err := hex.DecodeString(f.RawPathHex)
			if err != nil {
				t.Fatal(err)
			}
			name = string(b)
		}
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		var err error
		switch f.Kind {
		case "dir":
			err = os.Mkdir(path, 0700)
		case "symlink":
			err = os.Symlink(f.Target, path)
		default:
			var data []byte
			if f.Size > 0 {
				fill, e := hex.DecodeString(f.FillHex)
				if e != nil {
					t.Fatal(e)
				}
				data = append([]byte(f.Prefix), bytes.Repeat(fill, f.Size-len(f.Prefix))...)
			} else {
				data, err = hex.DecodeString(f.Hex)
			}
			if err == nil {
				err = os.WriteFile(path, data, 0600)
			}
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}
func textUnits(t domain.Text) string {
	var out bytes.Buffer
	for _, u := range t.Units() {
		fmt.Fprintf(&out, "%04x", u)
	}
	return out.String()
}
func observe(s Store, c fixtureCase) (any, error) {
	switch c.Method {
	case "readHandoff":
		v, e := s.ReadHandoff()
		return textUnits(v), e
	case "readDecisions":
		v, e := s.ReadDecisions()
		return textUnits(v), e
	case "readRequirement":
		v, e := s.ReadRequirement(c.Arg)
		return textUnits(v), e
	case "hasRequirement":
		return s.HasRequirement(c.Arg)
	case "listRequirements":
		return s.ListRequirements()
	case "listSkills":
		return s.ListSkills()
	case "readSkill":
		v, e := s.ReadSkill(c.Arg)
		return map[string]any{"name": v.Name, "path": v.Path, "sha256": v.SHA256, "chars": v.Chars, "description": textUnits(v.Description), "content": textUnits(v.Content)}, e
	case "pack":
		v, e := contextapp.BuildPack(s, contextapp.BuildOptions{})
		return textUnits(v), e
	case "catalog":
		v, e := contextapp.SkillCatalog(s)
		skills := []any{}
		for _, x := range v.Skills {
			skills = append(skills, map[string]any{"name": x.Name, "path": x.Path, "sha256": x.SHA256, "selection": x.Selection, "chars": x.Chars, "description": textUnits(x.Description)})
		}
		return map[string]any{"schema_version": v.SchemaVersion, "trust": v.Trust, "skills": skills}, e
	}
	panic(c.Method)
}
func TestNodeFileGoldens(t *testing.T) {
	root := filepath.Join("../../../../../..", "contracts/context/files-cli-v1")
	var input struct{ Cases []fixtureCase }
	var expected struct {
		Cases []struct {
			ID        string
			Value     json.RawMessage
			Error     string
			ErrorCode string `json:"error_code"`
		}
	}
	for name, v := range map[string]any{"cases.json": &input, "expected.json": &expected} {
		data, e := os.ReadFile(filepath.Join(root, name))
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(data, v); e != nil {
			t.Fatal(e)
		}
	}
	if len(input.Cases) != len(expected.Cases) {
		t.Fatal("fixture inventory drift")
	}
	for i, c := range input.Cases {
		t.Run(c.ID, func(t *testing.T) {
			local := t.TempDir()
			materialize(t, local, c.Files)
			if c.MissingRoot {
				local = filepath.Join(local, "absent")
			}
			store := New(local, corefiles.Reader{})
			if c.ProbeRace {
				store.observe = func(path string) {
					if err := os.Remove(path); err != nil {
						t.Fatal(err)
					}
				}
			}
			value, err := observe(store, c)
			want := expected.Cases[i]
			if want.ID != c.ID {
				t.Fatal("fixture ordering drift")
			}
			if want.ErrorCode != "" {
				if want.ErrorCode != "ENOENT" || !os.IsNotExist(err) {
					t.Fatalf("probe/read race: %v want code=%s", err, want.ErrorCode)
				}
				return
			}
			if want.Error != "" {
				if err == nil || err.Error() != want.Error {
					t.Fatalf("error=%v want=%q", err, want.Error)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			data, e := json.Marshal(value)
			if e != nil {
				t.Fatal(e)
			}
			var got, w any
			json.Unmarshal(data, &got)
			json.Unmarshal(want.Value, &w)
			if !reflect.DeepEqual(got, w) {
				t.Fatalf("Node value mismatch: got bytes=%d want bytes=%d", len(data), len(want.Value))
			}
		})
	}
}
