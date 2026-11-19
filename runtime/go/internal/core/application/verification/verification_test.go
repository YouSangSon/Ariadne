package verification_test

import (
	app "ariadne/runtime/internal/core/application/verification"
	v "ariadne/runtime/internal/core/domain/verification"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

func text(t *testing.T, s string) v.Text {
	t.Helper()
	b, e := hex.DecodeString(s)
	if e != nil || len(b)%2 != 0 {
		t.Fatal("invalid hex fixture")
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
func token(s *v.Text) any {
	if s == nil {
		return nil
	}
	return encoded(*s)
}

type input struct {
	ID, Op     string
	Names      []string
	Code       bool
	Log        *string
	Tokens     []*string
	ListError  *string
	ListCode   *bool
	ThrowAt    string
	ThrowIndex int
}
type port struct {
	t                *testing.T
	in               input
	modules          map[string]struct{}
	events           []map[string]any
	original         error
	starts, finishes int
}

func (p *port) event(kind string) map[string]any {
	e := map[string]any{"type": kind}
	p.events = append(p.events, e)
	return e
}
func (p *port) fail(at string, index int) error {
	if p.in.ThrowAt == at && p.in.ThrowIndex == index {
		return p.original
	}
	return nil
}
func (p *port) ListTests() ([]v.Text, *v.Text) {
	p.event("listTests")
	if p.in.ListError != nil {
		s := text(p.t, *p.in.ListError)
		return nil, &s
	}
	if p.in.ListCode != nil {
		if *p.in.ListCode {
			p.modules["code"] = struct{}{}
		} else {
			delete(p.modules, "code")
		}
	}
	r := make([]v.Text, len(p.in.Names))
	for i, s := range p.in.Names {
		r[i] = text(p.t, s)
	}
	return r, nil
}
func (p *port) getToken(i int) *v.Text {
	if len(p.in.Tokens) <= i || p.in.Tokens[i] == nil {
		return nil
	}
	s := text(p.t, *p.in.Tokens[i])
	return &s
}
func (p *port) RunTests(names []v.Text) (*v.Text, error) {
	e := p.event("runTests")
	a := make([]string, len(names))
	for i, s := range names {
		a[i] = encoded(s)
	}
	e["names"] = a
	return p.getToken(0), p.fail("runTests", 0)
}
func (p *port) CheckMirrors() (*v.Text, error) {
	p.event("checkMirrors")
	return p.getToken(1), p.fail("checkMirrors", 0)
}
func (p *port) CommitLog() (*v.Text, error) {
	p.event("commitLog")
	e := p.fail("commitLog", 0)
	if p.in.Log == nil {
		return nil, e
	}
	s := text(p.t, *p.in.Log)
	return &s, e
}
func (p *port) Start(name string) error {
	p.event("start")["name"] = encoded(v.TextOf(name))
	i := p.starts
	p.starts++
	return p.fail("start", i)
}
func (p *port) Finish(name string, s *v.Text) error {
	e := p.event("finish")
	e["name"] = encoded(v.TextOf(name))
	e["token"] = token(s)
	i := p.finishes
	p.finishes++
	return p.fail("finish", i)
}
func (p *port) Report(message string) error {
	p.event("report")["message"] = encoded(v.TextOf(message))
	return p.fail("report", 0)
}
func TestNodeGoldenApplication(t *testing.T) {
	const dir = "../../../../../../contracts/core/verification-node-v1/"
	var in struct{ Cases []input }
	var expected struct {
		Cases []struct {
			ID        string
			Value     json.RawMessage
			Events    []map[string]any
			Error     string
			SameError bool
		}
	}
	for name, target := range map[string]any{"cases.json": &in, "expected.json": &expected} {
		b, e := os.ReadFile(dir + name)
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(b, target); e != nil {
			t.Fatal(e)
		}
	}
	for _, c := range in.Cases {
		if c.Op != "run" {
			continue
		}
		t.Run(c.ID, func(t *testing.T) {
			modules := make(map[string]struct{})
			if c.Code {
				modules["code"] = struct{}{}
			}
			p := &port{t: t, in: c, modules: modules, original: errors.New("original port failure"), events: []map[string]any{}}
			before, _ := json.Marshal(c)
			code, err := app.VerifySources(modules, p)
			after, _ := json.Marshal(c)
			if string(before) != string(after) {
				t.Fatal("application mutated input")
			}
			for _, want := range expected.Cases {
				if want.ID != c.ID {
					continue
				}
				if want.Error != "" {
					if err != p.original || !want.SameError || encoded(v.TextOf(err.Error())) != want.Error {
						t.Fatalf("original port error lost: %v", err)
					}
				} else {
					var wantCode int
					if e := json.Unmarshal(want.Value, &wantCode); e != nil {
						t.Fatal(e)
					}
					if err != nil || code != wantCode {
						t.Fatalf("want code %d, got %d error %v", wantCode, code, err)
					}
				}
				b, _ := json.Marshal(p.events)
				var got []map[string]any
				if e := json.Unmarshal(b, &got); e != nil {
					t.Fatal(e)
				}
				if !reflect.DeepEqual(got, want.Events) {
					w, _ := json.Marshal(want.Events)
					t.Fatalf("Node events mismatch\nwant %s\ngot %s", w, b)
				}
				return
			}
			t.Fatal("missing Node golden")
		})
	}
}

type rewritingFinishPort struct {
	port
	runToken  v.Text
	rewritten bool
}

func (p *rewritingFinishPort) RunTests([]v.Text) (*v.Text, error) {
	return &p.runToken, nil
}

func (p *rewritingFinishPort) Finish(name string, token *v.Text) error {
	err := p.port.Finish(name, token)
	if token != nil {
		p.rewritten = true
		*token = v.Text{}
	}
	return err
}

func TestVerifySourcesPassesFinishTokenByValue(t *testing.T) {
	emptyLog := ""
	p := &rewritingFinishPort{
		port:     port{t: t, in: input{Names: []string{encoded(v.TextOf("one.test.mjs"))}, Log: &emptyLog}},
		runToken: v.TextOf("failed"),
	}
	code, err := app.VerifySources(nil, p)
	if err != nil || code != 1 || !p.rewritten || p.runToken.String() != "failed" || p.finishes != 1 {
		t.Fatalf("finish rewrote the source token or failure: code=%d error=%v token=%q finishes=%d", code, err, p.runToken, p.finishes)
	}
}
