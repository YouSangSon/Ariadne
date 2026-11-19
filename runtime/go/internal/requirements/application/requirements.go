// Package application coordinates Requirements through consumer-owned ports.
package application

import (
	"errors"
	"io"
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
type StreamInput struct {
	Kind    domain.Text
	Mode    *int64
	Size    int64
	Content io.Reader
}
type StreamSourcePorts struct {
	InspectGit   func() (GitState, error)
	SourceHasher func() (SourceHasher, error)
	// WithInput supplies one synchronous input and closes its resources before returning.
	WithInput func(path domain.Text, remaining int64, consume func(StreamInput) error) error
}
type SourceStateResult struct {
	Hash  string
	Head  *string
	Files []domain.Text
}

var (
	ErrSourceInputLimit   = errors.New("Source input size exceeds 64 MiB")
	ErrSourceInputChanged = errors.New("Source input changed during read")
	errSourceFrameCount   = errors.New("Source input must provide exactly one frame")
)

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
	return sourceState(ports.InspectGit, ports.SourceHasher, reqID, func(hasher SourceHasher, path domain.Text, remaining int64) (int64, error) {
		input, err := ports.ReadInput(path)
		if err != nil {
			return 0, err
		}
		size := int64(len(input.Content))
		if err := hashSourceHeader(hasher, path, input.Kind, input.Mode, size, remaining); err != nil {
			return 0, err
		}
		return size, hasher.Update(input.Content)
	})
}

func StreamSourceState(ports StreamSourcePorts, reqID *string) (SourceStateResult, error) {
	buffer := make([]byte, 64<<10)
	return sourceState(ports.InspectGit, ports.SourceHasher, reqID, func(hasher SourceHasher, path domain.Text, remaining int64) (int64, error) {
		var used int64
		var received bool
		var callbackErr error
		err := ports.WithInput(path, remaining, func(input StreamInput) error {
			if received {
				if callbackErr == nil {
					callbackErr = errSourceFrameCount
				}
				return callbackErr
			}
			received = true
			err := hashSourceHeader(hasher, path, input.Kind, input.Mode, input.Size, remaining)
			if err == nil && callbackErr == nil {
				err = hashSourceContent(hasher, input.Content, input.Size, buffer)
			}
			if callbackErr == nil {
				callbackErr = err
			}
			used = input.Size
			return callbackErr
		})
		if err != nil {
			return 0, err
		}
		if !received {
			return 0, errSourceFrameCount
		}
		return used, callbackErr
	})
}

func sourceState(inspect func() (GitState, error), makeHasher func() (SourceHasher, error), reqID *string, hashInput func(SourceHasher, domain.Text, int64) (int64, error)) (SourceStateResult, error) {
	if reqID != nil {
		value := *reqID
		reqID = &value
		if _, err := domain.Slug(value); err != nil {
			return SourceStateResult{}, err
		}
	}
	git, err := inspect()
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
	hasher, err := makeHasher()
	if err != nil {
		return SourceStateResult{}, err
	}
	remaining := int64(64 << 20)
	for _, path := range files {
		used, err := hashInput(hasher, path, remaining)
		if err != nil {
			return SourceStateResult{}, err
		}
		remaining -= used
	}
	digest, err := hasher.Digest()
	if err != nil {
		return SourceStateResult{}, err
	}
	return SourceStateResult{digest, head, files}, nil
}

func hashSourceHeader(hasher SourceHasher, path, kind domain.Text, mode *int64, size, remaining int64) error {
	if size < 0 || size > remaining {
		return ErrSourceInputLimit
	}
	header := append([]byte{'['}, quote(path)...)
	header = append(header, ',')
	header = append(header, quote(kind)...)
	header = append(header, ',')
	if mode == nil {
		header = append(header, "null"...)
	} else {
		// Match JSON.stringify(Number) for mode values supplied by a buffered port.
		header = strconv.AppendFloat(header, float64(*mode), 'f', -1, 64)
	}
	header = append(header, ',')
	header = strconv.AppendInt(header, size, 10)
	return hasher.Update(append(header, ']', '\n'))
}

func hashSourceContent(hasher SourceHasher, content io.Reader, size int64, buffer []byte) error {
	if content == nil {
		return ErrSourceInputChanged
	}
	for remaining := size; remaining > 0; {
		n, err := readSourceChunk(content, buffer[:min(remaining, int64(len(buffer)))])
		if err != nil && err != io.EOF {
			return err
		}
		if n > 0 {
			if err := hasher.Update(buffer[:n]); err != nil {
				return err
			}
			remaining -= int64(n)
		}
		if err == io.EOF {
			if remaining == 0 {
				return nil
			}
			return ErrSourceInputChanged
		}
	}
	n, err := readSourceChunk(content, buffer[:1])
	if err == io.EOF && n == 0 {
		return nil
	}
	if err != nil && err != io.EOF {
		return err
	}
	return ErrSourceInputChanged
}

func readSourceChunk(content io.Reader, buffer []byte) (int, error) {
	for range 100 {
		n, err := content.Read(buffer)
		if err != nil && err != io.EOF {
			return 0, err
		}
		if n < 0 || n > len(buffer) {
			return 0, ErrSourceInputChanged
		}
		if n != 0 || err != nil {
			return n, err
		}
	}
	return 0, io.ErrNoProgress
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
