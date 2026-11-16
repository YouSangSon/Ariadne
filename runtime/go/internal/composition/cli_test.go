package composition

import (
	"ariadne/runtime/internal/extensions/domain"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestE0CLIRejectsExecutionAndPreservesFailureOutput(t *testing.T) {
	for _, args := range [][]string{{"extensions", "run", "--input", "private.json"}, {"extensions", "inspect"}} {
		var out, errs bytes.Buffer
		if code := Run(args, &out, &errs); code != 2 || out.Len() != 0 || errs.Len() == 0 {
			t.Fatalf("unsupported command not rejected: %d %q %q", code, out.String(), errs.String())
		}
	}
}

func TestE0EnvironmentCommandNeverAuthorizesExecution(t *testing.T) {
	file := filepath.Join(t.TempDir(), "info.json")
	if err := os.WriteFile(file, []byte(`{"host":{"os":"linux","arch":"arm64","cgroupVersion":"v2","security":{"rootless":true,"seccompEnabled":true}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	var out, errs bytes.Buffer
	if code := Run([]string{"extensions", "environment", "--info", file}, &out, &errs); code != 0 {
		t.Fatalf("%d: %s", code, errs.String())
	}
	var got struct {
		Status           string
		RuntimeQualified bool
	}
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != "qualification-required" || got.RuntimeQualified {
		t.Fatalf("false qualification: %+v", got)
	}
}

func TestRegistryCLIRoundTripAndStrictArguments(t *testing.T) {
	workspace := t.TempDir()
	source := t.TempDir()
	wasm := []byte{0, 'a', 's', 'm', 13, 0, 1, 0}
	h := sha256.Sum256(wasm)
	m := domain.Manifest{SchemaVersion: 1, ExtensionID: "example/team-report", Version: "1.0.0", World: domain.World, ArtifactSHA256: hex.EncodeToString(h[:]), SDKMajor: 1, Description: "Team report", RequestedCapabilities: []string{}, License: "UNLICENSED"}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	for n, b := range map[string][]byte{"manifest.json": b, "extension.wasm": wasm} {
		if err = os.WriteFile(filepath.Join(source, n), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	command := func(args ...string) domain.RegistryView {
		t.Helper()
		var out, errs bytes.Buffer
		args = append([]string{"extensions"}, args...)
		args = append(args, "--workspace", workspace)
		if code := Run(args, &out, &errs); code != 0 {
			t.Fatalf("%d %s", code, errs.String())
		}
		var v domain.RegistryView
		if err = json.Unmarshal(out.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		if v.RuntimeQualified {
			t.Fatal("execution authorized")
		}
		return v
	}
	v := command("install", "--package", source)
	digest := v.Packages[0].Digest
	v = command("inspect", m.ExtensionID)
	v = command("activate", m.ExtensionID, "--digest", digest, "--expected-revision", strconv.FormatInt(v.Revision, 10))
	if !v.Enabled {
		t.Fatal(v)
	}
	v = command("disable", m.ExtensionID, "--expected-revision", strconv.FormatInt(v.Revision, 10))
	v = command("remove", m.ExtensionID, "--digest", digest, "--expected-revision", strconv.FormatInt(v.Revision, 10))
	if len(v.Packages) != 0 {
		t.Fatal(v)
	}
	for _, args := range [][]string{
		{"extensions", "install", "--package", source, "--package", source},
		{"extensions", "inspect", m.ExtensionID, "extra"},
		{"extensions", "inspect", "--package", source, m.ExtensionID},
		{"extensions", "disable", m.ExtensionID, "--expected-revision", "-1"},
		{"extensions", "activate", m.ExtensionID, "--digest", digest, "--expected-revision", "1", "--unknown", "x"},
		{"extensions", "inspect", m.ExtensionID, "--workspace", ""},
	} {
		var out, errs bytes.Buffer
		if code := Run(args, &out, &errs); code != 2 || out.Len() != 0 {
			t.Fatalf("%v => %d %s", args, code, errs.String())
		}
	}
}
func TestHelpE0AndRunRejectCreateNoRegistry(t *testing.T) {
	dir := t.TempDir()
	old, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(old)
	for _, args := range [][]string{{"--help"}, {"extensions", "run", "example/team-report"}, {"extensions", "inspect", "example/team-report"}, {"extensions", "project", "--input", "missing"}, {"extensions", "environment", "--info", "missing"}} {
		var out, errs bytes.Buffer
		Run(args, &out, &errs)
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != 0 {
			t.Fatal("read-only command created files", args, entries, err)
		}
	}
}
