package application_test

import (
	"ariadne/runtime/internal/context/application"
	"ariadne/runtime/internal/context/domain"
	"ariadne/runtime/internal/core/domain/requirementfields"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type skill struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	SHA256      string `json:"sha256"`
	Chars       int    `json:"chars"`
	Description string `json:"description_hex"`
	Content     string `json:"content_hex"`
	Selection   string `json:"selection"`
}
type storeInput struct {
	Skills           map[string]skill  `json:"skills"`
	Handoff          string            `json:"handoff_hex"`
	Decisions        string            `json:"decisions_hex"`
	Requirements     map[string]string `json:"requirements"`
	RequirementOrder []string          `json:"requirement_order"`
	SkillOrder       []string          `json:"skill_order"`
	Errors           map[string]string `json:"errors"`
}
type handoffInput struct {
	State       string `json:"state_hex"`
	Constraints string `json:"constraints_hex"`
	Blockers    string `json:"blockers_hex"`
	Legacy      string `json:"legacy_hex"`
}
type entry struct {
	ID             string       `json:"id"`
	Kind           string       `json:"kind"`
	Text           string       `json:"text_hex"`
	Path           []string     `json:"path"`
	Selection      string       `json:"selection"`
	SkillID        string       `json:"skill_id"`
	Requirement    string       `json:"requirement_hex"`
	Handoff        handoffInput `json:"handoff"`
	Decisions      string       `json:"decisions_hex"`
	Budget         string       `json:"budget"`
	SelectedSkills []skill      `json:"selected_skills"`
	ReqSlug        *string      `json:"req_slug"`
	Skills         []string     `json:"skills"`
	Store          storeInput   `json:"store"`
}
type observation struct {
	ID    string          `json:"id"`
	Kind  string          `json:"kind"`
	Trace []string        `json:"trace"`
	Value json.RawMessage `json:"value,omitempty"`
	Error string          `json:"error,omitempty"`
}

func text(t *testing.T, value string) domain.Text {
	t.Helper()
	b, e := hex.DecodeString(value)
	if e != nil || len(b)%2 != 0 {
		t.Fatalf("bad fixture hex: %s", e)
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
	}
	return domain.NewText(u)
}
func textHex(value domain.Text) string {
	var b strings.Builder
	for _, u := range value.Units() {
		fmt.Fprintf(&b, "%04x", u)
	}
	return b.String()
}
func h(t *testing.T, in handoffInput) domain.Handoff {
	return domain.Handoff{State: text(t, in.State), Constraints: text(t, in.Constraints), Blockers: text(t, in.Blockers), Legacy: text(t, in.Legacy)}
}
func packed(value domain.Text) any {
	return map[string]any{"pack_utf16_hex": textHex(value), "pack_utf16_units": value.Len(), "pack_utf8_hex": hex.EncodeToString([]byte(value.String()))}
}

type store struct {
	t     *testing.T
	input storeInput
	trace []string
}

func (s *store) call(name string) error {
	s.trace = append(s.trace, name)
	if message, ok := s.input.Errors[name]; ok {
		return errors.New(message)
	}
	return nil
}
func (s *store) ReadSkill(id string) (application.SkillRecord, error) {
	if e := s.call("readSkill:" + id); e != nil {
		return application.SkillRecord{}, e
	}
	v, ok := s.input.Skills[id]
	if !ok {
		s.t.Fatalf("missing offline skill %s", id)
	}
	return application.SkillRecord{Name: v.Name, Path: v.Path, SHA256: v.SHA256, Chars: v.Chars, Description: text(s.t, v.Description), Content: text(s.t, v.Content)}, nil
}
func (s *store) ReadHandoff() (domain.Text, error) {
	e := s.call("readHandoff")
	return text(s.t, s.input.Handoff), e
}
func (s *store) ReadDecisions() (domain.Text, error) {
	e := s.call("readDecisions")
	return text(s.t, s.input.Decisions), e
}
func (s *store) HasRequirement(slug string) (bool, error) {
	e := s.call("hasRequirement:" + slug)
	_, ok := s.input.Requirements[slug]
	return ok, e
}
func (s *store) ReadRequirement(slug string) (domain.Text, error) {
	if e := s.call("readRequirement:" + slug); e != nil {
		return domain.Text{}, e
	}
	v, ok := s.input.Requirements[slug]
	if !ok {
		s.t.Fatalf("missing offline REQ %s", slug)
	}
	return text(s.t, v), nil
}
func (s *store) ListRequirements() ([]string, error) {
	e := s.call("listRequirements")
	v := s.input.RequirementOrder
	if v == nil {
		if len(s.input.Requirements) > 1 {
			s.t.Fatal("fixture requires explicit order for multiple REQs")
		}
		for k := range s.input.Requirements {
			v = append(v, k)
		}
	}
	return v, e
}
func (s *store) ListSkills() ([]string, error) {
	e := s.call("listSkills")
	v := s.input.SkillOrder
	if v == nil {
		if len(s.input.Skills) > 1 {
			s.t.Fatal("fixture requires explicit order for multiple skills")
		}
		for k := range s.input.Skills {
			v = append(v, k)
		}
	}
	return v, e
}
func observe(t *testing.T, in entry) observation {
	s := &store{t: t, input: in.Store, trace: []string{}}
	out := observation{ID: in.ID, Kind: in.Kind}
	var v any
	var err error
	switch in.Kind {
	case "handoff":
		var result domain.Handoff
		result, err = domain.HandoffSections(text(t, in.Text))
		v = map[string]string{"state_hex": textHex(result.State), "constraints_hex": textHex(result.Constraints), "blockers_hex": textHex(result.Blockers), "legacy_hex": textHex(result.Legacy)}
	case "field":
		var result []uint16
		result, err = requirementfields.FieldBlock(text(t, in.Text).Units(), in.Path)
		v = map[string]string{"text_hex": textHex(domain.NewText(result))}
	case "selection":
		var result domain.Selection
		result, err = domain.SkillSelection(in.Selection)
		v = map[string]string{"id": result.ID, "sha256": result.SHA256}
	case "metadata":
		var result domain.Metadata
		result, err = domain.SkillMetadata(in.SkillID, text(t, in.Text))
		v = map[string]string{"name": result.Name, "description_hex": textHex(result.Description)}
	case "render":
		selected := make([]domain.SelectedSkill, len(in.SelectedSkills))
		for i, k := range in.SelectedSkills {
			selected[i] = domain.SelectedSkill{Selection: k.Selection, Path: k.Path, Content: text(t, k.Content)}
		}
		var result domain.Text
		result, err = domain.RenderPack(domain.RenderInput{Requirement: text(t, in.Requirement), Handoff: h(t, in.Handoff), Decisions: text(t, in.Decisions), Budget: in.Budget, SelectedSkills: selected})
		v = packed(result)
	case "build":
		var result domain.Text
		result, err = application.BuildPack(s, application.BuildOptions{Budget: in.Budget, ReqSlug: in.ReqSlug, Skills: in.Skills})
		v = packed(result)
	case "catalog":
		var result application.Catalog
		result, err = application.SkillCatalog(s)
		skills := []any{}
		for _, k := range result.Skills {
			skills = append(skills, map[string]any{"name": k.Name, "path": k.Path, "sha256": k.SHA256, "chars": k.Chars, "description_hex": textHex(k.Description), "selection": k.Selection})
		}
		v = map[string]any{"schema_version": result.SchemaVersion, "trust": result.Trust, "skills": skills}
	default:
		t.Fatal("unknown fixture kind " + in.Kind)
	}
	out.Trace = s.trace
	if err != nil {
		out.Error = err.Error()
	} else {
		out.Value, _ = json.Marshal(v)
	}
	return out
}
func TestNodeGoldens(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "..")
	var corpus struct {
		Cases []entry `json:"cases"`
	}
	var expected struct {
		Cases []observation `json:"cases"`
	}
	for p, dst := range map[string]any{"cases.json": &corpus, "expected.json": &expected} {
		b, e := os.ReadFile(filepath.Join(root, "contracts/context/node-v1", p))
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(b, dst); e != nil {
			t.Fatal(e)
		}
	}
	if len(corpus.Cases) != len(expected.Cases) {
		t.Fatal("oracle input/output count drift")
	}
	for i, in := range corpus.Cases {
		t.Run(in.ID, func(t *testing.T) {
			got, want := observe(t, in), expected.Cases[i]
			if got.ID != want.ID || got.Kind != want.Kind || got.Error != want.Error || !reflect.DeepEqual(got.Trace, want.Trace) {
				t.Fatalf("got error=%q trace=%v; want error=%q trace=%v", got.Error, got.Trace, want.Error, want.Trace)
			}
			var g, w any
			if len(got.Value) > 0 {
				json.Unmarshal(got.Value, &g)
			}
			if len(want.Value) > 0 {
				json.Unmarshal(want.Value, &w)
			}
			if !reflect.DeepEqual(g, w) {
				t.Fatalf("value differs from actual Node (kind=%s)", in.Kind)
			}
		})
	}
}

// sentinelStore verifies error identity as well as the recorded oracle's messages.
type sentinelStore struct {
	err    error
	failAt string
}

func (s sentinelStore) failure(at string) error {
	if at == s.failAt {
		return s.err
	}
	return nil
}
func (s sentinelStore) ReadSkill(string) (application.SkillRecord, error) {
	return application.SkillRecord{SHA256: strings.Repeat("a", 64)}, s.failure("ReadSkill")
}
func (s sentinelStore) ReadHandoff() (domain.Text, error) {
	return domain.Text{}, s.failure("ReadHandoff")
}
func (s sentinelStore) ReadDecisions() (domain.Text, error) {
	return domain.Text{}, s.failure("ReadDecisions")
}
func (s sentinelStore) HasRequirement(string) (bool, error) { return true, s.failure("HasRequirement") }
func (s sentinelStore) ReadRequirement(string) (domain.Text, error) {
	return domain.FromString("metadata:\n  req_id: demo\n  status: verified"), s.failure("ReadRequirement")
}
func (s sentinelStore) ListRequirements() ([]string, error) {
	return []string{"demo"}, s.failure("ListRequirements")
}
func (s sentinelStore) ListSkills() ([]string, error) {
	return []string{"research"}, s.failure("ListSkills")
}
func TestPortErrorsAreReturnedUnchangedWithoutOutput(t *testing.T) {
	sentinel := errors.New("sentinel port error")
	slug := "demo"
	for _, at := range []string{"ReadSkill", "ReadHandoff", "ReadDecisions", "HasRequirement", "ReadRequirement", "ListRequirements"} {
		t.Run(at, func(t *testing.T) {
			options := application.BuildOptions{ReqSlug: &slug, Skills: []string{"research@" + strings.Repeat("a", 64)}}
			if at == "ListRequirements" {
				options.ReqSlug = nil
			}
			got, err := application.BuildPack(sentinelStore{sentinel, at}, options)
			if err != sentinel || got.Len() != 0 {
				t.Fatalf("got output=%d error=%v", got.Len(), err)
			}
		})
	}
	for _, at := range []string{"ListSkills", "ReadSkill"} {
		t.Run("catalog/"+at, func(t *testing.T) {
			got, err := application.SkillCatalog(sentinelStore{sentinel, at})
			if err != sentinel || got.SchemaVersion != 0 || got.Skills != nil {
				t.Fatal(got, err)
			}
		})
	}
}
func TestCatalogTypeCannotExposeContent(t *testing.T) {
	if _, ok := reflect.TypeFor[application.CatalogSkill]().FieldByName("Content"); ok {
		t.Fatal("catalog has a body field")
	}
}
