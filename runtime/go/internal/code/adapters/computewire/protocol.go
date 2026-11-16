// Package computewire owns the Code context's numeric JSON boundary.
package computewire

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"regexp"
	"strconv"
	"unicode/utf8"

	"ariadne/runtime/internal/code/domain"
)

const Protocol = "ariadne.compute/1"
const Operation = "cochange-counts/1"
const MaxRequestBytes = 16 << 20
const MaxResponseBytes = 32 << 20

type Error string

func (e Error) Error() string { return string(e) }

const (
	InvalidInput       Error = "INVALID_INPUT"
	UnsupportedVersion Error = "UNSUPPORTED_VERSION"
	LimitExceeded      Error = "LIMIT_EXCEEDED"
	ProtocolError      Error = "PROTOCOL_ERROR"
)

var requestID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var digest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var integer = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var codes = map[string]bool{"INVALID_INPUT": true, "UNSUPPORTED_VERSION": true, "LIMIT_EXCEEDED": true, "UNAVAILABLE": true, "BUSY": true, "CANCELLED": true, "DEADLINE_EXCEEDED": true, "PROTOCOL_ERROR": true, "ENGINE_FAILED": true}

type Request struct {
	RequestID, InputDigest string
	Input                  domain.CoChangeInput
}
type Response struct {
	Counts *domain.CoChangeCounts
	Code   string
}

func CanonicalPayload(input domain.CoChangeInput) ([]byte, error) {
	if err := domain.ValidateInput(input); err != nil {
		return nil, domainError(err)
	}
	out := []byte(`{"fileCount":`)
	out = strconv.AppendUint(out, uint64(input.FileCount), 10)
	out = append(out, `,"commits":[`...)
	for i, commit := range input.Commits {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, '[')
		for j, id := range commit {
			if j > 0 {
				out = append(out, ',')
			}
			out = strconv.AppendUint(out, uint64(id), 10)
		}
		out = append(out, ']')
	}
	out = append(out, ']', '}')
	return out, nil
}
func NewRequest(id string, input domain.CoChangeInput) (Request, error) {
	payload, err := CanonicalPayload(input)
	if err != nil {
		return Request{}, err
	}
	hash := sha256.Sum256(payload)
	request := Request{RequestID: id, InputDigest: hex.EncodeToString(hash[:]), Input: input}
	return request, validateRequest(request)
}
func validateRequest(request Request) error {
	if !requestID.MatchString(request.RequestID) || !digest.MatchString(request.InputDigest) {
		return InvalidInput
	}
	payload, err := CanonicalPayload(request.Input)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(payload)
	if hex.EncodeToString(hash[:]) != request.InputDigest {
		return InvalidInput
	}
	return nil
}
func domainError(err error) error {
	if err == domain.ErrLimitExceeded {
		return LimitExceeded
	}
	return InvalidInput
}
func envelope(request Request) map[string]any {
	return map[string]any{"protocol": Protocol, "operation": Operation, "requestId": request.RequestID, "inputDigest": request.InputDigest}
}
func EncodeRequest(request Request) ([]byte, error) {
	if err := validateRequest(request); err != nil {
		return nil, err
	}
	payload, _ := CanonicalPayload(request.Input)
	out := envelope(request)
	out["payload"] = json.RawMessage(payload)
	return json.Marshal(out)
}
func DecodeRequest(raw []byte) (Request, error) {
	value, err := parse(raw, MaxRequestBytes)
	if err != nil {
		return Request{}, err
	}
	object, ok := fields(value, "protocol", "operation", "requestId", "inputDigest", "payload")
	if !ok {
		return Request{}, InvalidInput
	}
	request, err := correlation(object)
	if err != nil {
		return Request{}, err
	}
	payload, ok := fields(object["payload"], "fileCount", "commits")
	if !ok {
		return Request{}, InvalidInput
	}
	count, ok := uint32Value(payload["fileCount"])
	if !ok {
		return Request{}, InvalidInput
	}
	commits, ok := payload["commits"].([]any)
	if !ok {
		return Request{}, InvalidInput
	}
	if count > domain.MaxFiles || len(commits) > domain.MaxCommits {
		return Request{}, LimitExceeded
	}
	input := domain.CoChangeInput{FileCount: count, Commits: make([][]uint32, len(commits))}
	for i, entry := range commits {
		ids, ok := entry.([]any)
		if !ok {
			return Request{}, InvalidInput
		}
		if len(ids) > domain.MaxFilesPerCommit {
			return Request{}, LimitExceeded
		}
		input.Commits[i] = make([]uint32, len(ids))
		for j, item := range ids {
			id, ok := uint32Value(item)
			if !ok {
				return Request{}, InvalidInput
			}
			input.Commits[i][j] = id
		}
	}
	request.Input = input
	return request, validateRequest(request)
}
func correlation(object map[string]any) (Request, error) {
	protocol, okProtocol := object["protocol"].(string)
	operation, okOperation := object["operation"].(string)
	if !okProtocol || !okOperation {
		return Request{}, InvalidInput
	}
	if protocol != Protocol || operation != Operation {
		return Request{}, UnsupportedVersion
	}
	id, okID := object["requestId"].(string)
	hash, okHash := object["inputDigest"].(string)
	if !okID || !okHash || !requestID.MatchString(id) || !digest.MatchString(hash) {
		return Request{}, InvalidInput
	}
	return Request{RequestID: id, InputDigest: hash}, nil
}
func EncodeResponse(expected Request, response Response) ([]byte, error) {
	if err := validateRequest(expected); err != nil {
		return nil, err
	}
	out := envelope(expected)
	if response.Counts == nil {
		if !codes[response.Code] {
			return nil, ProtocolError
		}
		out["status"] = "error"
		out["code"] = response.Code
	} else {
		if response.Code != "" {
			return nil, ProtocolError
		}
		if err := domain.ValidateCounts(expected.Input, *response.Counts); err != nil {
			return nil, domainError(err)
		}
		out["status"] = "ok"
		frequencies := append([]uint32{}, response.Counts.Frequencies...)
		pairs := make([][4]uint32, len(response.Counts.Pairs))
		for i, pair := range response.Counts.Pairs {
			pairs[i] = [4]uint32{pair.A, pair.B, pair.Count, pair.FirstSeenOrdinal}
		}
		out["frequencies"] = frequencies
		out["pairs"] = pairs
	}
	return json.Marshal(out)
}
func DecodeResponse(raw []byte, expected Request) (Response, error) {
	if err := validateRequest(expected); err != nil {
		return Response{}, err
	}
	response, err := decodeResponse(raw, expected)
	if err != nil && err != LimitExceeded {
		return Response{}, ProtocolError
	}
	return response, err
}
func decodeResponse(raw []byte, expected Request) (Response, error) {
	value, err := parse(raw, MaxResponseBytes)
	if err != nil {
		return Response{}, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return Response{}, ProtocolError
	}
	actual, err := correlation(object)
	if err != nil {
		return Response{}, err
	}
	if actual.RequestID != expected.RequestID || actual.InputDigest != expected.InputDigest {
		return Response{}, ProtocolError
	}
	if object["status"] == "error" {
		if _, ok := fields(value, "protocol", "operation", "requestId", "inputDigest", "status", "code"); !ok {
			return Response{}, ProtocolError
		}
		code, ok := object["code"].(string)
		if !ok || !codes[code] {
			return Response{}, ProtocolError
		}
		return Response{Code: code}, nil
	}
	if object["status"] != "ok" {
		return Response{}, ProtocolError
	}
	if _, ok := fields(value, "protocol", "operation", "requestId", "inputDigest", "status", "frequencies", "pairs"); !ok {
		return Response{}, ProtocolError
	}
	frequencies, okF := object["frequencies"].([]any)
	pairs, okP := object["pairs"].([]any)
	if !okF || !okP || len(frequencies) != int(expected.Input.FileCount) {
		return Response{}, ProtocolError
	}
	if len(pairs) > domain.MaxPairs {
		return Response{}, LimitExceeded
	}
	counts := domain.CoChangeCounts{Frequencies: make([]uint32, len(frequencies)), Pairs: make([]domain.PairCount, len(pairs))}
	for i, item := range frequencies {
		n, ok := uint32Value(item)
		if !ok {
			return Response{}, ProtocolError
		}
		counts.Frequencies[i] = n
	}
	for i, item := range pairs {
		tuple, ok := item.([]any)
		if !ok || len(tuple) != 4 {
			return Response{}, ProtocolError
		}
		var pair [4]uint32
		for j, item := range tuple {
			n, ok := uint32Value(item)
			if !ok {
				return Response{}, ProtocolError
			}
			pair[j] = n
		}
		counts.Pairs[i] = domain.PairCount{A: pair[0], B: pair[1], Count: pair[2], FirstSeenOrdinal: pair[3]}
	}
	if err := domain.ValidateCounts(expected.Input, counts); err != nil {
		return Response{}, domainError(err)
	}
	return Response{Counts: &counts}, nil
}
func fields(value any, names ...string) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	if !ok || len(object) != len(names) {
		return nil, false
	}
	for _, name := range names {
		if _, exists := object[name]; !exists {
			return nil, false
		}
	}
	return object, true
}
func uint32Value(value any) (uint32, bool) {
	number, ok := value.(json.Number)
	if !ok || !integer.MatchString(string(number)) {
		return 0, false
	}
	n, err := strconv.ParseUint(string(number), 10, 32)
	return uint32(n), err == nil
}
func parse(raw []byte, limit int) (any, error) {
	if len(raw) > limit {
		return nil, LimitExceeded
	}
	if !utf8.Valid(raw) || !validUnicodeEscapes(raw) {
		return nil, InvalidInput
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := readValue(decoder, 0)
	if err != nil {
		return nil, InvalidInput
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nil, InvalidInput
	}
	return value, nil
}
func readValue(decoder *json.Decoder, depth int) (any, error) {
	if depth > 5 {
		return nil, InvalidInput
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, InvalidInput
	}
	switch token {
	case json.Delim('{'):
		object := map[string]any{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil, InvalidInput
			}
			name, ok := key.(string)
			if !ok {
				return nil, InvalidInput
			}
			if _, exists := object[name]; exists {
				return nil, InvalidInput
			}
			value, err := readValue(decoder, depth+1)
			if err != nil {
				return nil, err
			}
			object[name] = value
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
			return nil, InvalidInput
		}
		return object, nil
	case json.Delim('['):
		array := make([]any, 0)
		for decoder.More() {
			value, err := readValue(decoder, depth+1)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim(']') {
			return nil, InvalidInput
		}
		return array, nil
	default:
		if number, ok := token.(json.Number); ok {
			if _, valid := uint32Value(number); !valid {
				return nil, InvalidInput
			}
		}
		return token, nil
	}
}

// encoding/json replaces unpaired UTF-16 escapes; the wire contract rejects them.
func validUnicodeEscapes(raw []byte) bool {
	inString := false
	for i := 0; i < len(raw); i++ {
		if raw[i] == '"' {
			inString = !inString
			continue
		}
		if !inString || raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		code, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if code >= 0xdc00 && code <= 0xdfff {
			return false
		}
		if code < 0xd800 || code > 0xdbff {
			continue
		}
		if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
			return false
		}
		low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
		if err != nil || low < 0xdc00 || low > 0xdfff {
			return false
		}
		i += 6
	}
	return true
}
