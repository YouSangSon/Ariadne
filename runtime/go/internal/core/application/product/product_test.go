package product_test

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"

	"ariadne/runtime/internal/core/application/product"
	domain "ariadne/runtime/internal/core/domain/product"
)

func TestNodeGoldenRunProduct(t *testing.T) {
	const root = "../../../../../../contracts/core/product-node-v1/"
	var inputs struct {
		Cases []struct {
			ID, Op, Action string
			Modules        []string
			Statuses       []int
			RunErrorAt     *int
			ReportErrorAt  *int
		}
	}
	var expected struct {
		Cases []struct {
			ID     string
			Value  json.RawMessage
			Error  string
			Events json.RawMessage
		}
	}
	for filename, target := range map[string]any{"cases.json": &inputs, "expected.json": &expected} {
		data, err := os.ReadFile(root + filename)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(data, target); err != nil {
			t.Fatal(err)
		}
	}
	for _, in := range inputs.Cases {
		if in.Op != "run" {
			continue
		}
		t.Run(in.ID, func(t *testing.T) {
			events := []any{}
			runs, reports := 0, 0
			runFailure, reportFailure := errors.New("run failed"), errors.New("report failed")
			originalModules := append([]string{}, in.Modules...)
			code, err := product.RunProduct(in.Action, in.Modules, product.Ports{
				Run: func(step domain.Step) (int, error) {
					events = append(events, map[string]any{"type": "run", "step": map[string]any{"command": step.Command, "args": step.Args, "cwd": step.CWD}})
					index := runs
					runs++
					if in.RunErrorAt != nil && index == *in.RunErrorAt {
						return 0, runFailure
					}
					if index < len(in.Statuses) {
						return in.Statuses[index], nil
					}
					return 0, nil
				},
				Report: func(message string) error {
					events = append(events, map[string]any{"type": "report", "message": message})
					index := reports
					reports++
					if in.ReportErrorAt != nil && index == *in.ReportErrorAt {
						return reportFailure
					}
					return nil
				},
			})
			if !reflect.DeepEqual(in.Modules, originalModules) {
				t.Fatal("orchestration mutated modules")
			}
			found := false
			for _, want := range expected.Cases {
				if want.ID != in.ID {
					continue
				}
				found = true
				if want.Error != "" {
					if err == nil || err.Error() != want.Error {
						t.Fatalf("want error %q, got %v", want.Error, err)
					}
					if want.Error == "run failed" && err != runFailure || want.Error == "report failed" && err != reportFailure {
						t.Fatal("port error identity lost")
					}
				} else {
					var status int
					if decodeErr := json.Unmarshal(want.Value, &status); decodeErr != nil {
						t.Fatal(decodeErr)
					}
					if err != nil || code != status {
						t.Fatalf("want exit %d, got %d, %v", status, code, err)
					}
				}
				data, err := json.Marshal(events)
				if err != nil {
					t.Fatal(err)
				}
				var got, literal any
				if err := json.Unmarshal(data, &got); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(want.Events, &literal); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(got, literal) {
					t.Fatalf("Node events\nwant %s\ngot %s", want.Events, data)
				}
			}
			if !found {
				t.Fatal("missing Node golden")
			}
		})
	}
}
