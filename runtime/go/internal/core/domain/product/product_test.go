package product_test

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"ariadne/runtime/internal/core/domain/product"
)

type input struct {
	ID          string            `json:"id"`
	Op          string            `json:"op"`
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	CodeCommand string            `json:"codeCommand"`
	Defaults    []string          `json:"defaults"`
	Action      string            `json:"action"`
	Modules     []string          `json:"modules"`
	Environment map[string]string `json:"environment"`
}
type outcome struct {
	ID    string          `json:"id"`
	Value json.RawMessage `json:"value"`
	Error string          `json:"error"`
}

func readCases(t *testing.T) ([]input, map[string]outcome) {
	t.Helper()
	const root = "../../../../../../contracts/core/product-node-v1/"
	var inputs struct {
		Cases []input `json:"cases"`
	}
	var expected struct {
		Cases []outcome `json:"cases"`
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
	byID := map[string]outcome{}
	for _, value := range expected.Cases {
		byID[value.ID] = value
	}
	return inputs.Cases, byID
}

func projection(plan product.Plan) map[string]any {
	value := map[string]any{"kind": plan.Kind}
	if plan.Kind == "help" {
		return value
	}
	value["path"] = plan.Path
	value["args"] = append([]string{}, plan.Args...)
	if plan.Command != "" {
		value["command"] = plan.Command
	}
	if plan.CWD != nil {
		value["cwd"] = *plan.CWD
	}
	if plan.Module != "" {
		value["module"] = plan.Module
	}
	if plan.InstallRoot {
		value["installRoot"] = true
	}
	return value
}

func TestNodeGoldenDomain(t *testing.T) {
	inputs, expected := readCases(t)
	for _, in := range inputs {
		if in.Op == "run" {
			continue
		}
		t.Run(in.ID, func(t *testing.T) {
			var value any
			var err error
			switch in.Op {
			case "plan":
				var plan product.Plan
				plan, err = product.CommandPlan(in.Command, in.Args, in.CodeCommand)
				value = projection(plan)
			case "select":
				value, err = product.SelectModules(in.Args, in.Defaults)
			case "environment":
				value = product.LifecycleEnvironment(in.Action, in.Environment)
			case "steps":
				steps := []any{}
				for _, step := range product.LifecycleSteps(in.Action, in.Modules) {
					steps = append(steps, map[string]any{"command": step.Command, "args": step.Args, "cwd": step.CWD})
				}
				value = steps
			default:
				t.Fatalf("unknown operation %s", in.Op)
			}
			want, found := expected[in.ID]
			if !found {
				t.Fatal("missing Node golden")
			}
			if want.Error != "" {
				if err == nil || err.Error() != want.Error {
					t.Fatalf("want error %q, got %v", want.Error, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			data, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			var got, literal any
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(want.Value, &literal); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, literal) {
				t.Fatalf("Node golden %s\nwant %s\ngot  %s", in.ID, want.Value, data)
			}
		})
	}
}

func TestInputsAndResultsAreIndependent(t *testing.T) {
	args := make([]string, 2, 12)
	copy(args, []string{"install-agent", "--example"})
	backing := args[:cap(args)]
	for i := len(args); i < len(backing); i++ {
		backing[i] = "untouched"
	}
	before := append([]string{}, backing...)
	plan, err := product.CommandPlan("code", args, "code")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(backing, before) {
		t.Fatal("command planning changed caller backing array")
	}
	plan.Args[0] = "changed"
	if !reflect.DeepEqual(backing, before) {
		t.Fatal("command args alias caller")
	}
	for _, command := range []string{"context", "memory", "setup"} {
		plan, err := product.CommandPlan(command, args, "code")
		if err != nil {
			t.Fatal(err)
		}
		plan.Args[0] = "changed"
		if !reflect.DeepEqual(backing, before) {
			t.Fatalf("%s args alias caller", command)
		}
	}
	defaults := []string{"code", "core", "code"}
	selected, err := product.SelectModules(nil, defaults)
	if err != nil {
		t.Fatal(err)
	}
	selected[0] = "changed"
	if defaults[0] != "code" {
		t.Fatal("selected modules alias defaults")
	}
	env := map[string]string{"EMPTY": "", "ONNXRUNTIME_NODE_INSTALL": "original", "DATABASE_URL": "sentinel"}
	copied := product.LifecycleEnvironment("verify", env)
	copied["EMPTY"] = "changed"
	if env["EMPTY"] != "" || env["ONNXRUNTIME_NODE_INSTALL"] != "original" || env["DATABASE_URL"] != "sentinel" {
		t.Fatal("environment mutated")
	}
	modules := []string{"code", "core", "memory"}
	steps := product.LifecycleSteps("setup", modules)
	steps[0].Args[0] = "changed"
	fresh := product.LifecycleSteps("setup", modules)
	if fresh[0].Args[0] != "ci" || steps[1].Args[0] != "ci" {
		t.Fatal("steps share mutable args")
	}
	if !reflect.DeepEqual(modules, []string{"code", "core", "memory"}) {
		t.Fatal("steps mutated modules")
	}
}
