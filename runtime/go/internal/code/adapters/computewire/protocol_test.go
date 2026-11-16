package computewire

import (
	"ariadne/runtime/internal/code/domain"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

const fixtureRoot = "../../../../../../contracts/compute/v1/fixtures"

type fixtureCase struct{ Name, Request, Response, CanonicalPayload, SHA256 string }
type rejectCase struct{ Name, File, ExpectedCode string }

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(fixtureRoot, name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestSharedContractFixtures(t *testing.T) {
	var cases struct {
		Valid                             []fixtureCase
		EquivalentRequest                 string
		InvalidRequests, InvalidResponses []rejectCase
		ErrorResponses                    []string
	}
	if err := json.Unmarshal(fixture(t, "cases.json"), &cases); err != nil {
		t.Fatal(err)
	}
	for _, entry := range cases.Valid {
		t.Run(entry.Name, func(t *testing.T) {
			request, err := DecodeRequest(fixture(t, entry.Request))
			if err != nil {
				t.Fatal(err)
			}
			canonical, err := CanonicalPayload(request.Input)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(canonical, fixture(t, entry.CanonicalPayload)) {
				t.Fatal("canonical bytes drift")
			}
			hash := sha256.Sum256(canonical)
			if hex.EncodeToString(hash[:]) != entry.SHA256 || request.InputDigest != entry.SHA256 {
				t.Fatal("digest drift")
			}
			response, err := DecodeResponse(fixture(t, entry.Response), request)
			if err != nil {
				t.Fatal(err)
			}
			counts, err := domain.CountReference(request.Input)
			if err != nil {
				t.Fatal(err)
			}
			if response.Counts == nil || !reflect.DeepEqual(counts, *response.Counts) {
				t.Fatalf("counts=%+v expected=%+v", counts, response.Counts)
			}
			encoded, err := EncodeRequest(request)
			if err != nil {
				t.Fatal(err)
			}
			roundtrip, err := DecodeRequest(encoded)
			if err != nil || !reflect.DeepEqual(request, roundtrip) {
				t.Fatal("request roundtrip", err)
			}
			encoded, err = EncodeResponse(request, response)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := DecodeResponse(encoded, request)
			if err != nil || !reflect.DeepEqual(decoded, response) {
				t.Fatal("response roundtrip", err)
			}
		})
	}
	expected, err := DecodeRequest(fixture(t, "tiny-request.json"))
	if err != nil {
		t.Fatal(err)
	}
	equivalent, err := DecodeRequest(fixture(t, cases.EquivalentRequest))
	if err != nil || !reflect.DeepEqual(expected, equivalent) {
		t.Fatal("payload key order affected digest", err)
	}
	for _, entry := range cases.InvalidRequests {
		t.Run("request/"+entry.Name, func(t *testing.T) {
			if _, err := DecodeRequest(fixture(t, entry.File)); err == nil || err.Error() != entry.ExpectedCode {
				t.Fatalf("expected %s, got %v", entry.ExpectedCode, err)
			}
		})
	}
	for _, entry := range cases.InvalidResponses {
		t.Run("response/"+entry.Name, func(t *testing.T) {
			if _, err := DecodeResponse(fixture(t, entry.File), expected); err == nil || err.Error() != entry.ExpectedCode {
				t.Fatalf("expected %s, got %v", entry.ExpectedCode, err)
			}
		})
	}
	for _, name := range cases.ErrorResponses {
		response, err := DecodeResponse(fixture(t, name), expected)
		if err != nil || response.Counts != nil || response.Code == "" {
			t.Fatal(name, err)
		}
		encoded, err := EncodeResponse(expected, response)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = DecodeResponse(encoded, expected); err != nil {
			t.Fatal(err)
		}
	}
}
func TestWireBoundsBeforeParseAndExpectedRequest(t *testing.T) {
	if _, err := DecodeRequest(bytes.Repeat([]byte{' '}, MaxRequestBytes+1)); err != LimitExceeded {
		t.Fatal(err)
	}
	request, _ := NewRequest("limit", domain.CoChangeInput{})
	if _, err := DecodeResponse(bytes.Repeat([]byte{' '}, MaxResponseBytes+1), request); err != LimitExceeded {
		t.Fatal(err)
	}
	if _, err := DecodeResponse(fixture(t, "tiny-response.json"), Request{}); err == nil {
		t.Fatal("missing expected request accepted")
	}
	for _, input := range []domain.CoChangeInput{{FileCount: domain.MaxFiles + 1}, {Commits: make([][]uint32, domain.MaxCommits+1)}, {FileCount: 26, Commits: [][]uint32{make([]uint32, 26)}}} {
		if _, err := NewRequest("limit", input); err != LimitExceeded {
			t.Fatal(err)
		}
	}
	for _, payload := range []string{`{"fileCount":37501,"commits":[]}`, `{"fileCount":0,"commits":[` + string(bytes.Repeat([]byte("[],"), domain.MaxCommits)) + `[]]}`, `{"fileCount":26,"commits":[[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]]}`} {
		raw := []byte(`{"protocol":"ariadne.compute/1","operation":"cochange-counts/1","requestId":"limit","inputDigest":"` + request.InputDigest + `","payload":` + payload + `}`)
		if _, err := DecodeRequest(raw); err != LimitExceeded {
			t.Fatal(err)
		}
	}
	if _, err := EncodeResponse(request, Response{Code: "raw payload"}); err == nil {
		t.Fatal("unknown code accepted")
	}
	empty, _ := domain.CountReference(request.Input)
	if _, err := EncodeResponse(request, Response{Counts: &empty, Code: "INVALID_INPUT"}); err == nil {
		t.Fatal("mixed response accepted")
	}
}

type checkpointContext struct {
	context.Context
	remaining int
}

func (c *checkpointContext) Err() error {
	c.remaining--
	if c.remaining <= 0 {
		return context.Canceled
	}
	return nil
}
func TestDecodeResponseContextPreservesCancellationAcrossBoundedPhases(t *testing.T) {
	request, err := NewRequest("cancel", domain.CoChangeInput{})
	if err != nil {
		t.Fatal(err)
	}
	// One large token must not hide cancellation inside encoding/json's buffered read.
	raw := []byte(`{"protocol":"` + strings.Repeat("x", MaxResponseBytes-128) + `"}`)
	ctx := &checkpointContext{Context: context.Background(), remaining: 10}
	if _, err = DecodeResponseContext(ctx, raw, request); !errors.Is(err, context.Canceled) {
		t.Fatalf("prescan cancellation lost: %v", err)
	}
	ctx = &checkpointContext{Context: context.Background(), remaining: 4}
	decoder := json.NewDecoder(&contextReader{ctx: ctx, r: bytes.NewReader(append(append([]byte{'"'}, bytes.Repeat([]byte("x"), 1<<20)...), '"'))})
	decoder.UseNumber()
	if _, err = decoder.Token(); err == nil || ctx.Err() == nil {
		t.Fatalf("token ignored cancellation: %v", err)
	}
	escaped := []byte(`"` + strings.Repeat(`\ud800\udc00`, 4096) + `"`)
	ctx = &checkpointContext{Context: context.Background(), remaining: 4}
	if validUnicodeEscapesContext(ctx, escaped) {
		t.Fatal("escape jumps skipped cancellation checkpoint")
	}
	// A rune spanning the 4096-byte prescan chunk remains valid.
	boundary := append(bytes.Repeat([]byte("x"), 4095), []byte("😀")...)
	if !validUTF8(context.Background(), boundary) {
		t.Fatal("UTF-8 chunk split rejected a valid rune")
	}
}
func TestMaximumValidateCountsFiniteTail(t *testing.T) {
	input := domain.CoChangeInput{FileCount: 37500, Commits: make([][]uint32, 1500)}
	for i := range input.Commits {
		for j := range 25 {
			input.Commits[i] = append(input.Commits[i], uint32(i*25+j))
		}
	}
	counts, err := domain.CountReference(input)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if err = domain.ValidateCounts(input, counts); err != nil {
		t.Fatal(err)
	}
	t.Logf("bounded non-context domain validation tail: %s for %d pairs", time.Since(start), len(counts.Pairs))
}
