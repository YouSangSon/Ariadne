package composition

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestE0CLIRejectsExecutionAndPreservesFailureOutput(t *testing.T) {
	for _, args := range [][]string{{"extensions", "run", "--input", "private.json"}, {"extensions", "install", "--package", "pkg"}, {"extensions", "inspect"}} {
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
