package ontology

import (
	"bufio"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
	"os"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"unicode"
)

const unicodeRoot = "../../../../../contracts/ontology/unicode-17/"

func codepoints(value string) string {
	out := []rune{}
	for _, field := range strings.Fields(value) {
		n, err := strconv.ParseInt(field, 16, 32)
		if err != nil {
			panic(err)
		}
		out = append(out, rune(n))
	}
	return string(out)
}
func TestUnicode17NormalizationConformance(t *testing.T) {
	file, err := os.Open(unicodeRoot + "NormalizationTest.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	rows, checks := 0, 0
	for scanner.Scan() {
		line := strings.TrimSpace(strings.Split(scanner.Text(), "#")[0])
		if line == "" || strings.HasPrefix(line, "@") {
			continue
		}
		columns := strings.Split(line, ";")
		want := codepoints(columns[3])
		rows++
		for i := 0; i < 5; i++ {
			checks++
			if got := scalarNFKC(codepoints(columns[i])); got != want {
				t.Fatalf("normalization row %d col %d got %x want %x", rows, i, []rune(got), []rune(want))
			}
		}
	}
	if err = scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if rows != 20034 || checks != 100170 {
		t.Fatal(rows, checks)
	}
}
func TestUnicode17ProfileAndExhaustiveScalarHashes(t *testing.T) {
	if norm.Version != "17.0.0" || cases.UnicodeVersion != "17.0.0" || unicode.Version != "17.0.0" {
		t.Fatal(runtime.Version(), norm.Version, cases.UnicodeVersion, unicode.Version)
	}
	lower := cases.Lower(language.Und, cases.HandleFinalSigma(false))
	lowerHash, properties := sha256.New(), sha256.New()
	frame := make([]byte, 4)
	count, maxRunes, maxMarks := 0, 0, 0
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if r >= 0xd800 && r <= 0xdfff {
			continue
		}
		count++
		mapped := lower.String(string(r))
		binary.BigEndian.PutUint32(frame, uint32(len(mapped)))
		lowerHash.Write(frame)
		lowerHash.Write([]byte(mapped))
		flags := byte(0)
		if inRanges(r, casedRanges) {
			flags |= 1
		}
		if inRanges(r, caseIgnorableRanges) {
			flags |= 2
		}
		properties.Write([]byte{flags})
		decomposed := []rune(norm.NFKD.String(string(r)))
		if len(decomposed) > maxRunes {
			maxRunes = len(decomposed)
		}
		marks := 0
		for _, d := range decomposed {
			if d == 0x034f && r != 0x034f {
				t.Fatalf("scalar inserted CGJ %x", r)
			}
			if norm.NFD.PropertiesString(string(d)).CCC() != 0 {
				marks++
				if marks > maxMarks {
					maxMarks = marks
				}
			} else {
				marks = 0
			}
		}
	}
	if count != 1112064 || maxRunes != 18 || maxMarks != 3 {
		t.Fatal(count, maxRunes, maxMarks)
	}
	if got := hex.EncodeToString(lowerHash.Sum(nil)); got != "9128cbd760037a58f7a2ecd9d7b88d04ef999a0ac8d557667c4dcf22a0e60257" {
		t.Fatal("Node scalar lower hash mismatch", got)
	}
	if got := hex.EncodeToString(properties.Sum(nil)); got != "d0cd426457a02c5ba0189b2cc0b35ee4fbc97dc068ad7286cf2f76d053c18202" {
		t.Fatal("Node properties hash mismatch", got)
	}
}
func TestUTF16OperationsAndDefensiveCopies(t *testing.T) {
	original := []uint16{0xd83d, 0xde00, 0xd800}
	value := NewText(original)
	original[0] = 0
	units := value.Units()
	units[1] = 0
	if !reflect.DeepEqual(value.Units(), []uint16{0xd83d, 0xde00, 0xd800}) || value.Len() != 3 || !value.Includes(NewText([]uint16{0xde00})) || !value.Includes(NewText([]uint16{0xd83d})) {
		t.Fatal(value.Units())
	}
	if value.Compare(NewText([]uint16{0xe000})) >= 0 {
		t.Fatal("sort must compare units")
	}
	if !NewText([]uint16{0xfeff, 'A', 0xfeff}).Trim().Equal(FromString("A")) || !NewText([]uint16{0x85, 'A', 0x85}).Trim().Equal(NewText([]uint16{0x85, 'A', 0x85})) {
		t.Fatal("ECMAScript trim")
	}
}
func TestFullContextAndUnpairedBarriers(t *testing.T) {
	cases := [][2]string{{"\u0345Σ", "\u0345σ"}, {"A\u0345Σ", "a\u0345ς"}, {"AΣ\u0345A", "aσ\u0345a"}, {"AΣ" + strings.Repeat(".", 100) + "A", "aσ" + strings.Repeat(".", 100) + "a"}, {"İ", "i\u0307"}, {"각", "각"}, {"a" + strings.Repeat("\u0301", 31), "á" + strings.Repeat("\u0301", 30)}, {"a" + strings.Repeat("\u0301", 30) + "\u034f\u0301", "á" + strings.Repeat("\u0301", 29) + "\u034f\u0301"}}
	for _, v := range cases {
		if got := Normalize(FromString(v[0])); !got.Equal(FromString(v[1])) {
			t.Fatalf("got %x want %x", got.Units(), FromString(v[1]).Units())
		}
	}
	input := NewText([]uint16{'A', 0x3a3, 0xd800, 'A', 0x345, 0x3a3, 0xdfff})
	want := []uint16{'a', 0x3c2, 0xd800, 'a', 0x345, 0x3c2, 0xdfff}
	if got := Normalize(input).Units(); !reflect.DeepEqual(got, want) {
		t.Fatal(got, want)
	}
}
func TestConcurrentNormalizationAndMetamorphicContexts(t *testing.T) {
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			for _, context := range []string{"AΣ" + strings.Repeat("\u0301", 100) + "A", "\u0345Σ", "AΣ\u0345", "ＡＢＣ", "a\u0323\u0301"} {
				normalized := Normalize(FromString(context))
				if !Normalize(normalized).Equal(normalized) {
					t.Error("normalization is not idempotent")
				}
				for _, barrier := range []uint16{0xd800, 0xdfff} {
					joined := append(FromString(context).Units(), barrier)
					joined = append(joined, FromString(context).Units()...)
					want := append(normalized.Units(), barrier)
					want = append(want, normalized.Units()...)
					if !reflect.DeepEqual(Normalize(NewText(joined)).Units(), want) {
						t.Error("barrier changed scalar context")
					}
				}
			}
		})
	}
	group.Wait()
}
func BenchmarkMaximumAuthoredText(b *testing.B) {
	text := FromString("AΣ" + strings.Repeat("\u0301", 1998))
	for b.Loop() {
		Normalize(text)
	}
}

func TestUnicodeFixtureProvenance(t *testing.T) {
	expected := map[string]string{
		"NormalizationTest.txt":     "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db",
		"SpecialCasing.txt":         "efc25faf19de21b92c1194c111c932e03d2a5eaf18194e33f1156e96de4c9588",
		"DerivedCoreProperties.txt": "24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08",
		"unicode-LICENSE.txt":       "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
		"x-text-LICENSE.txt":        "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad",
	}
	for name, want := range expected {
		data, err := os.ReadFile(unicodeRoot + name)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != want {
			t.Fatal(name, "hash drift", got)
		}
	}
}
