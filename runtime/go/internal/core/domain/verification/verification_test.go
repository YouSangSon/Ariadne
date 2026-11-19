package verification_test

import (
	v "ariadne/runtime/internal/core/domain/verification"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func text(t *testing.T, s string) v.Text {
	t.Helper()
	b, e := hex.DecodeString(s)
	if e != nil || len(b)%2 != 0 {
		t.Fatalf("bad fixture hex %q", s)
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
	}
	return v.NewText(u)
}
func encoded(s v.Text) string {
	u := s.Units()
	b := make([]byte, 2*len(u))
	for i, x := range u {
		b[2*i] = byte(x >> 8)
		b[2*i+1] = byte(x)
	}
	return hex.EncodeToString(b)
}
func texts(t *testing.T, a []string) []v.Text {
	r := make([]v.Text, len(a))
	for i, s := range a {
		r[i] = text(t, s)
	}
	return r
}
func encodedTexts(a []v.Text) []string {
	r := make([]string, len(a))
	for i, s := range a {
		r[i] = encoded(s)
	}
	return r
}
func TestNodeGoldenDomain(t *testing.T) {
	const dir = "../../../../../../contracts/core/verification-node-v1/"
	var in struct {
		Cases []struct {
			ID, Op, Text string
			Names        []string
			Code         bool
		}
	}
	var out struct {
		Cases []struct {
			ID    string
			Value json.RawMessage
			Error string
		}
	}
	for name, target := range map[string]any{"cases.json": &in, "expected.json": &out} {
		b, e := os.ReadFile(dir + name)
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(b, target); e != nil {
			t.Fatal(e)
		}
	}
	wants := map[string]struct {
		Value json.RawMessage
		Error string
	}{}
	for _, o := range out.Cases {
		wants[o.ID] = struct {
			Value json.RawMessage
			Error string
		}{o.Value, o.Error}
	}
	for _, c := range in.Cases {
		if c.Op == "run" {
			continue
		}
		t.Run(c.ID, func(t *testing.T) {
			var got any
			var err error
			switch c.Op {
			case "command":
				d := v.CheckCommitCommand(text(t, c.Text))
				m := map[string]any{"ok": d.OK}
				if d.Skip {
					m["skip"] = true
				}
				if d.Reason != nil {
					m["reason"] = encoded(*d.Reason)
				}
				got = m
			case "req":
				got = v.HasRequirementReference(text(t, c.Text))
			case "log":
				s := v.CommitErrors(text(t, c.Text))
				if s != nil {
					got = encoded(*s)
				}
			case "sources":
				names := texts(t, c.Names)
				before := encodedTexts(names)
				var result []v.Text
				result, err = v.SourceTests(names, c.Code)
				got = encodedTexts(result)
				if !reflect.DeepEqual(encodedTexts(names), before) {
					t.Fatal("caller names mutated")
				}
			default:
				t.Fatalf("unknown operation %q", c.Op)
			}
			want, found := wants[c.ID]
			if !found {
				t.Fatal("missing Node golden")
			}
			if want.Error != "" {
				if err == nil || encoded(v.TextOf(err.Error())) != want.Error {
					t.Fatalf("want error %s, got %v", want.Error, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			b, e := json.Marshal(got)
			if e != nil {
				t.Fatal(e)
			}
			var g, w any
			if e = json.Unmarshal(b, &g); e != nil {
				t.Fatal(e)
			}
			if e = json.Unmarshal(want.Value, &w); e != nil {
				t.Fatal(e)
			}
			if !reflect.DeepEqual(g, w) {
				t.Fatalf("Node golden mismatch\nwant %s\ngot %s", want.Value, b)
			}
		})
	}
}
func TestTextIsLosslessAndImmutable(t *testing.T) {
	units := []uint16{'a', 0xd800, 0xdc00, 0xdfff}
	s := v.NewText(units)
	units[0] = 'z'
	copy := s.Units()
	copy[1] = 'x'
	if !reflect.DeepEqual(s.Units(), []uint16{'a', 0xd800, 0xdc00, 0xdfff}) {
		t.Fatal("Text aliases input or Units output")
	}
	if s.String() != "a𐀀�" {
		t.Fatalf("display %q", s.String())
	}
	names := []v.Text{v.TextOf("b.test.mjs"), v.TextOf("a.test.mjs")}
	selected, e := v.SourceTests(names, false)
	if e != nil {
		t.Fatal(e)
	}
	if len(selected) != 2 {
		t.Fatalf("want two selected tests, got %d", len(selected))
	}
	selected[0] = v.TextOf("changed")
	if names[0].String() != "b.test.mjs" || names[1].String() != "a.test.mjs" {
		t.Fatal("selected slice aliases caller")
	}
}
