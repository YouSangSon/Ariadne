// Package application coordinates Requirements through consumer-owned ports.
package application

import (
	"errors"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"

	"ariadne/runtime/internal/requirements/domain"
)

type LoadPorts struct {
	ReadRequirement func(string) (domain.Text, error)
	Hash            func([]byte) (string, error)
}
type Contract struct {
	ReqID, Status string
	Criteria      []domain.Criterion
	Hash          string
}
type GitState struct {
	Head  *string
	Paths []domain.Text
}
type SourceInput struct {
	Kind    domain.Text
	Mode    *int64
	Content []byte
}
type SourceHasher interface {
	Update([]byte) error
	Digest() (string, error)
}
type SourcePorts struct {
	InspectGit   func() (GitState, error)
	SourceHasher func() (SourceHasher, error)
	ReadInput    func(domain.Text) (SourceInput, error)
}
type SourceStateResult struct {
	Hash  string
	Head  *string
	Files []domain.Text
}

func LoadContract(ports LoadPorts, reqID string) (Contract, error) {
	if _, err := domain.Slug(reqID); err != nil {
		return Contract{}, err
	}
	yaml, err := ports.ReadRequirement(reqID)
	if err != nil {
		return Contract{}, err
	}
	parsed, err := domain.ParseContract(yaml, reqID)
	if err != nil {
		return Contract{}, err
	}
	payload := append([]byte(`{"req_id":`), quote(domain.FromString(reqID))...)
	payload = append(payload, `,"criteria":[`...)
	for i, c := range parsed.Criteria {
		if i > 0 {
			payload = append(payload, ',')
		}
		payload = append(payload, `{"id":`...)
		payload = append(payload, quote(c.ID)...)
		payload = append(payload, `,"statement":`...)
		payload = append(payload, quote(c.Statement)...)
		payload = append(payload, `,"verification":`...)
		payload = append(payload, quote(c.Verification)...)
		payload = append(payload, '}')
	}
	payload = append(payload, `],"scope":[`...)
	for i, s := range parsed.Scope {
		if i > 0 {
			payload = append(payload, ',')
		}
		payload = append(payload, quote(s)...)
	}
	payload = append(payload, ']', '}')
	hash, err := ports.Hash(payload)
	if err != nil {
		return Contract{}, err
	}
	return Contract{reqID, parsed.Status, parsed.Criteria, hash}, nil
}
func SourceState(ports SourcePorts, reqID *string) (SourceStateResult, error) {
	if reqID != nil {
		value := *reqID
		reqID = &value
		if _, err := domain.Slug(value); err != nil {
			return SourceStateResult{}, err
		}
	}
	git, err := ports.InspectGit()
	if err != nil {
		return SourceStateResult{}, err
	}
	var head *string
	if git.Head != nil {
		value := *git.Head
		head = &value
	}
	files, err := domain.SourceFiles(git.Paths, reqID)
	if err != nil {
		return SourceStateResult{}, err
	}
	hasher, err := ports.SourceHasher()
	if err != nil {
		return SourceStateResult{}, err
	}
	total := uint64(0)
	for _, path := range files {
		input, err := ports.ReadInput(path)
		if err != nil {
			return SourceStateResult{}, err
		}
		total += uint64(len(input.Content))
		if total > 64*1024*1024 {
			return SourceStateResult{}, errors.New("Source input size exceeds 64 MiB")
		}
		header := append([]byte{'['}, quote(path)...)
		header = append(header, ',')
		header = append(header, quote(input.Kind)...)
		header = append(header, ',')
		if input.Mode == nil {
			header = append(header, "null"...)
		} else {
			// Match JSON.stringify(Number); large integer modes use the shortest binary64 decimal.
			header = strconv.AppendFloat(header, float64(*input.Mode), 'f', -1, 64)
		}
		header = append(header, ',')
		header = strconv.AppendInt(header, int64(len(input.Content)), 10)
		header = append(header, ']', 10)
		if err := hasher.Update(header); err != nil {
			return SourceStateResult{}, err
		}
		if err := hasher.Update(input.Content); err != nil {
			return SourceStateResult{}, err
		}
	}
	digest, err := hasher.Digest()
	if err != nil {
		return SourceStateResult{}, err
	}
	return SourceStateResult{digest, head, files}, nil
}

// quote matches JSON.stringify string bytes, including lone units and unescaped LS/PS and HTML.
func quote(text domain.Text) []byte {
	units := text.Units()
	out := []byte{'"'}
	hex := "0123456789abcdef"
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch u {
		case '"', '\\':
			out = append(out, '\\', byte(u))
			continue
		case 8:
			out = append(out, '\\', 'b')
			continue
		case 9:
			out = append(out, '\\', 't')
			continue
		case 10:
			out = append(out, '\\', 'n')
			continue
		case 12:
			out = append(out, '\\', 'f')
			continue
		case 13:
			out = append(out, '\\', 'r')
			continue
		}
		if u >= 0xd800 && u <= 0xdbff && i+1 < len(units) && units[i+1] >= 0xdc00 && units[i+1] <= 0xdfff {
			out = utf8.AppendRune(out, utf16.DecodeRune(rune(u), rune(units[i+1])))
			i++
			continue
		}
		if u < 32 || u >= 0xd800 && u <= 0xdfff {
			out = append(out, '\\', 'u', hex[u>>12], hex[u>>8&15], hex[u>>4&15], hex[u&15])
		} else {
			out = utf8.AppendRune(out, rune(u))
		}
	}
	return append(out, '"')
}
