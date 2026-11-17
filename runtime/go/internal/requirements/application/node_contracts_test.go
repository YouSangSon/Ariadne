package application

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"os"
	"reflect"
	"strconv"
	"testing"

	"ariadne/runtime/internal/requirements/domain"
)

type portError struct {
	Message  string
	Original bool `json:"original_port_error"`
}
type event struct {
	Call  string
	ReqID string `json:"req_id_utf16_hex,omitempty"`
	Path  string `json:"path_utf16_hex,omitempty"`
	Index *int   `json:"index,omitempty"`
}
type payload struct {
	Hex string `json:"utf8_hex"`
	SHA string `json:"sha256"`
}
type contentRecipe struct {
	Length int
	Byte   byte
}
type sourceInput struct {
	Kind    json.RawMessage
	Mode    *int64
	Content string         `json:"content_hex"`
	Recipe  *contentRecipe `json:"content_recipe"`
}
type appInput struct {
	ID, Op string
	ReqID  *string `json:"req_id"`
	YAML   json.RawMessage
	Head   *string
	Paths  []json.RawMessage
	Inputs map[string]sourceInput
	Recipe *struct {
		Count, Width, Duplicates, Excluded int
		Prefix                             string
	} `json:"path_recipe"`
	Fail      string
	FailAt    int    `json:"fail_at"`
	FailPath  string `json:"fail_path"`
	Mutations *struct {
		ReqID string `json:"inspect_req_id"`
		Head  string `json:"factory_head"`
	}
}
type frame struct {
	Type   string
	Length int
	SHA    string `json:"sha256"`
	Hex    string
	Recipe *contentRecipe
}
type outcome struct {
	Error *portError
	Value struct {
		ReqID        string `json:"req_id"`
		Status, Hash string
		Head         *string
	}
	UTF16 struct {
		Criteria []struct{ ID, Statement, Verification string }
		Files    []string
	} `json:"utf16_hex"`
}
type appExpected struct {
	ID           string
	Load, Result outcome
	Events       []event
	Payloads     []payload
	Updates      []frame
}

func unitHex(text domain.Text) string {
	u := text.Units()
	b := make([]byte, len(u)*2)
	for i, c := range u {
		binary.BigEndian.PutUint16(b[2*i:], c)
	}
	return hex.EncodeToString(b)
}

// Fixture transport is ASCII JSON with authored \u code units; this decoder is independent of the scalar implementation.
func fixtureText(t *testing.T, raw json.RawMessage) domain.Text {
	t.Helper()
	var u []uint16
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			u = append(u, uint16(raw[i]))
			continue
		}
		i++
		if raw[i] == 'u' {
			n, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
			if err != nil {
				t.Fatal(err)
			}
			u = append(u, uint16(n))
			i += 4
			continue
		}
		s, err := strconv.Unquote("\"" + string(raw[i-1:i+1]) + "\"")
		if err != nil {
			t.Fatal(err)
		}
		u = append(u, uint16(s[0]))
	}
	return domain.NewText(u)
}
func loadFixtures(t *testing.T) ([]appInput, map[string]appExpected) {
	t.Helper()
	read := func(name string) []byte {
		b, e := os.ReadFile("../../../../../contracts/requirements/node-v1/" + name)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	var inputs struct{ Cases []appInput }
	var expected struct{ Cases []json.RawMessage }
	if err := json.Unmarshal(read("cases.json"), &inputs); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(read("expected.json"), &expected); err != nil {
		t.Fatal(err)
	}
	values := map[string]appExpected{}
	for _, raw := range expected.Cases {
		var header struct{ Op string }
		if err := json.Unmarshal(raw, &header); err != nil {
			t.Fatal(err)
		}
		if header.Op != "contract" && header.Op != "state" {
			continue
		}
		var v appExpected
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		values[v.ID] = v
	}
	return inputs.Cases, values
}
func compareError(t *testing.T, err error, want *portError, sentinel error) bool {
	t.Helper()
	if want != nil {
		if err == nil || err.Error() != want.Message {
			t.Fatalf("error=%v want=%q", err, want.Message)
		}
		if want.Original && err != sentinel {
			t.Fatal("port error identity lost")
		}
		return true
	}
	if err != nil {
		t.Fatal(err)
	}
	return false
}
func TestLoadContractNodeOracle(t *testing.T) {
	inputs, expected := loadFixtures(t)
	for _, input := range inputs {
		if input.Op != "contract" {
			continue
		}
		t.Run(input.ID, func(t *testing.T) {
			want := expected[input.ID]
			events := []event{}
			payloads := []payload{}
			sentinel := errors.New("injected " + input.Fail)
			yaml := fixtureText(t, input.YAML)
			before := yaml.Units()
			got, err := LoadContract(LoadPorts{
				ReadRequirement: func(id string) (domain.Text, error) {
					events = append(events, event{Call: "readRequirement", ReqID: unitHex(domain.FromString(id))})
					if input.Fail == "readRequirement" {
						return domain.Text{}, sentinel
					}
					return yaml, nil
				},
				Hash: func(b []byte) (string, error) {
					events = append(events, event{Call: "hash"})
					sum := sha256.Sum256(b)
					p := payload{hex.EncodeToString(b), hex.EncodeToString(sum[:])}
					payloads = append(payloads, p)
					if input.Fail == "hash" {
						return "", sentinel
					}
					return p.SHA, nil
				},
			}, *input.ReqID)
			if !reflect.DeepEqual(events, want.Events) || !reflect.DeepEqual(payloads, want.Payloads) {
				t.Fatalf("events=%#v payloads=%#v want events=%#v payloads=%#v", events, payloads, want.Events, want.Payloads)
			}
			if !reflect.DeepEqual(yaml.Units(), before) {
				t.Fatal("load changed input")
			}
			if compareError(t, err, want.Load.Error, sentinel) {
				return
			}
			if got.ReqID != want.Load.Value.ReqID || got.Status != want.Load.Value.Status || got.Hash != want.Load.Value.Hash {
				t.Fatalf("contract=%#v", got)
			}
			actual := [][3]string{}
			for _, c := range got.Criteria {
				actual = append(actual, [3]string{unitHex(c.ID), unitHex(c.Statement), unitHex(c.Verification)})
			}
			criteria := [][3]string{}
			for _, c := range want.Load.UTF16.Criteria {
				criteria = append(criteria, [3]string{c.ID, c.Statement, c.Verification})
			}
			if !reflect.DeepEqual(actual, criteria) {
				t.Fatalf("criteria=%v want=%v", actual, criteria)
			}
		})
	}
}

type recordingHasher struct {
	input    appInput
	events   *[]event
	frames   *[]frame
	current  *sourceInput
	sentinel error
	hash     hash.Hash
}

func (h *recordingHasher) Update(b []byte) error {
	index := len(*h.frames)
	*h.events = append(*h.events, event{Call: "update", Index: &index})
	sum := sha256.Sum256(b)
	f := frame{Type: "header", Length: len(b), SHA: hex.EncodeToString(sum[:]), Hex: ""}
	if index%2 == 1 {
		f.Type = "raw"
		if (*h.current).Recipe != nil {
			f.Recipe = (*h.current).Recipe
			f.Hex = ""
		}
	}
	if f.Recipe == nil {
		f.Hex = hex.EncodeToString(b)
	}
	*h.frames = append(*h.frames, f)
	if h.input.Fail == "update" && h.input.FailAt == index {
		return h.sentinel
	}
	h.hash.Write(b)
	return nil
}
func (h *recordingHasher) Digest() (string, error) {
	*h.events = append(*h.events, event{Call: "digest"})
	if h.input.Fail == "digest" {
		return "", h.sentinel
	}
	return hex.EncodeToString(h.hash.Sum(nil)), nil
}
func TestSourceStateNodeOracle(t *testing.T) {
	inputs, expected := loadFixtures(t)
	for _, input := range inputs {
		if input.Op != "state" {
			continue
		}
		t.Run(input.ID, func(t *testing.T) {
			want := expected[input.ID]
			events := []event{}
			frames := []frame{}
			sentinel := errors.New("injected " + input.Fail)
			paths := []domain.Text{}
			for _, p := range input.Paths {
				paths = append(paths, fixtureText(t, p))
			}
			if r := input.Recipe; r != nil {
				prefix, width := r.Prefix, r.Width
				if prefix == "" {
					prefix = "file-"
				}
				if width == 0 {
					width = 5
				}
				for i := 0; i < r.Count; i++ {
					paths = append(paths, domain.FromString(prefix+fmt.Sprintf("%0*d", width, i)))
				}
			}
			before := append([]domain.Text{}, paths...)
			current := sourceInput{}
			var reqID *string
			if input.ReqID != nil {
				value := *input.ReqID
				reqID = &value
			}
			var head *string
			if input.Head != nil {
				value := *input.Head
				head = &value
			}
			got, err := SourceState(SourcePorts{
				InspectGit: func() (GitState, error) {
					events = append(events, event{Call: "inspectGit"})
					if input.Fail == "inspectGit" {
						return GitState{}, sentinel
					}
					if input.Mutations != nil {
						*reqID = input.Mutations.ReqID
					}
					return GitState{Head: head, Paths: paths}, nil
				},
				SourceHasher: func() (SourceHasher, error) {
					events = append(events, event{Call: "sourceHasher"})
					if input.Fail == "sourceHasher" {
						return nil, sentinel
					}
					if input.Mutations != nil {
						*head = input.Mutations.Head
					}
					return &recordingHasher{input, &events, &frames, &current, sentinel, sha256.New()}, nil
				},
				ReadInput: func(path domain.Text) (SourceInput, error) {
					events = append(events, event{Call: "readInput", Path: unitHex(path)})
					if input.Fail == "readInput" && (input.FailPath == "" || input.FailPath == path.String()) {
						return SourceInput{}, sentinel
					}
					// Event hex checks lossless path identity before this fixture-only UTF8 map lookup.
					var ok bool
					current, ok = input.Inputs[path.String()]
					if !ok {
						t.Fatalf("missing fixture path %s", unitHex(path))
					}
					var content []byte
					if current.Recipe != nil {
						content = bytes.Repeat([]byte{current.Recipe.Byte}, current.Recipe.Length)
					} else {
						var e error
						content, e = hex.DecodeString(current.Content)
						if e != nil {
							t.Fatal(e)
						}
					}
					return SourceInput{Kind: fixtureText(t, current.Kind), Mode: current.Mode, Content: content}, nil
				},
			}, reqID)
			if !reflect.DeepEqual(before, paths) {
				t.Fatal("application changed Git paths")
			}
			if !reflect.DeepEqual(events, want.Events) || !reflect.DeepEqual(frames, want.Updates) {
				t.Fatalf("events=%#v frames=%#v want events=%#v frames=%#v", events, frames, want.Events, want.Updates)
			}
			if compareError(t, err, want.Result.Error, sentinel) {
				return
			}
			if got.Hash != want.Result.Value.Hash || !reflect.DeepEqual(got.Head, want.Result.Value.Head) {
				t.Fatalf("source result=%#v", got)
			}
			actual := []string{}
			for _, p := range got.Files {
				actual = append(actual, unitHex(p))
			}
			if !reflect.DeepEqual(actual, want.Result.UTF16.Files) {
				t.Fatalf("source files=%v", actual)
			}
		})
	}
}

func TestSourceStateOwnsReturnedProvenance(t *testing.T) {
	head := "original"
	paths := []domain.Text{domain.FromString("a")}
	events := []event{}
	frames := []frame{}
	current := sourceInput{}
	content := []byte{0, 255, 10}
	got, err := SourceState(SourcePorts{
		InspectGit: func() (GitState, error) { return GitState{&head, paths}, nil },
		SourceHasher: func() (SourceHasher, error) {
			return &recordingHasher{events: &events, frames: &frames, current: &current, hash: sha256.New()}, nil
		},
		ReadInput: func(domain.Text) (SourceInput, error) {
			return SourceInput{Kind: domain.FromString("file"), Content: content}, nil
		},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	*got.Head = "changed"
	got.Files[0] = domain.FromString("changed")
	if head != "original" || paths[0].String() != "a" || !bytes.Equal(content, []byte{0, 255, 10}) {
		t.Fatal("returned state aliases provenance or application mutated inputs")
	}
}
