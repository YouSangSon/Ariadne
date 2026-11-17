// Package product holds product dispatch and lifecycle policies without executing them.
package product

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

type Plan struct {
	Kind, Command, Path string
	Args                []string
	// A nil CWD inherits the caller directory; an empty value selects the checkout root.
	CWD         *string
	Module      string
	InstallRoot bool
}

type Step struct {
	Command string
	Args    []string
	CWD     string
}

func CommandPlan(command string, args []string, codeCommand string) (Plan, error) {
	args = slices.Clone(args)
	node := func(path string, args []string) Plan {
		return Plan{Kind: "process", Command: "node", Path: path, Args: args}
	}
	switch command {
	case "", "--help", "-h", "help":
		return Plan{Kind: "help"}, nil
	case "setup", "verify":
		plan := node("scripts/product.mjs", append([]string{command}, args...))
		cwd := ""
		plan.CWD = &cwd
		return plan, nil
	case "context":
		return node("lib/context-pack.mjs", args), nil
	case "skills":
		return node("lib/skill-catalog.mjs", args), nil
	case "eval":
		scripts := map[string]string{"compare": "compare-cli.mjs", "memory-ablation": "memory-ablation-cli.mjs"}
		if len(args) > 0 {
			if script, ok := scripts[args[0]]; ok {
				return node("evaluation/"+script, args[1:]), nil
			}
		}
		return Plan{}, errors.New("eval requires compare or memory-ablation --file <path>")
	case "ontology":
		return node("modules/ontology/cli.mjs", args), nil
	case "install-rules":
		plan := node("scripts/install.mjs", args)
		plan.InstallRoot = true
		return plan, nil
	case "knowledge":
		scripts := map[string]string{"promote": "promote.mjs", "index": "graph-index.mjs"}
		if len(args) > 0 {
			if script, ok := scripts[args[0]]; ok {
				return node("modules/llm-wiki/"+script, args[1:]), nil
			}
		}
		return Plan{}, errors.New("knowledge requires promote or index")
	case "code":
		if len(args) > 0 && (args[0] == "install-agent" || args[0] == "install-hook") {
			hasCommand, hasName := slices.Contains(args, "--command"), slices.Contains(args, "--name")
			if !hasCommand {
				args = append(args, "--command", codeCommand)
			}
			if args[0] == "install-agent" && !hasName {
				args = append(args, "--name", "ariadne-code")
			}
		}
		plan := node("packages/code/dist/src/cli.js", args)
		plan.Module = "code"
		return plan, nil
	case "memory":
		if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
			return Plan{Kind: "help"}, nil
		}
		if args[0] == "init" {
			return Plan{Kind: "memory-init", Path: "packages/memory/dist/src/cli.js", Args: args, Module: "memory"}, nil
		}
		if args[0] == "backup-create" {
			cwd := "packages/memory"
			return Plan{Kind: "process", Command: "sh", Path: "packages/memory/scripts/create-backup.sh", Args: args[1:], CWD: &cwd}, nil
		}
		services := map[string]string{"serve": "src/app/server.js", "worker": "src/app/worker.js", "mcp": "src/mcp/server.js", "migrate": "src/db/migrate.js", "backup-verify": "scripts/backup-verify.js", "restore-smoke": "scripts/restore-smoke.js"}
		if service, ok := services[args[0]]; ok {
			plan := node("packages/memory/dist/"+service, args[1:])
			plan.Module = "memory"
			if args[0] == "restore-smoke" {
				cwd := "packages/memory"
				plan.CWD = &cwd
			}
			return plan, nil
		}
		plan := node("packages/memory/dist/src/cli.js", args)
		plan.Module = "memory"
		return plan, nil
	default:
		return Plan{}, fmt.Errorf("unknown command: %s", command)
	}
}

// SelectModules preserves default order, or prepends core to an explicit selection.
func SelectModules(args, defaults []string) ([]string, error) {
	selected := []string{}
	if len(args) == 0 {
		for _, name := range defaults {
			if !slices.Contains(selected, name) {
				selected = append(selected, name)
			}
		}
		return selected, nil
	}
	var value string
	switch {
	case len(args) == 2 && args[0] == "--modules":
		value = args[1]
	case len(args) == 1 && strings.HasPrefix(args[0], "--modules="):
		value = strings.TrimPrefix(args[0], "--modules=")
	default:
		return nil, errors.New("expected --modules core,memory,code,ontology")
	}
	names := strings.Split(value, ",")
	for _, name := range names {
		if name != "core" && name != "memory" && name != "code" && name != "ontology" {
			return nil, errors.New("modules must be a nonempty list of core,memory,code,ontology")
		}
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			return nil, errors.New("duplicate modules are not allowed")
		}
		seen[name] = true
	}
	selected = append(selected, "core")
	for _, name := range names {
		if name != "core" {
			selected = append(selected, name)
		}
	}
	return selected, nil
}

func LifecycleEnvironment(action string, environment map[string]string) map[string]string {
	env := make(map[string]string, len(environment)+1)
	for key, value := range environment {
		env[key] = value
	}
	env["ONNXRUNTIME_NODE_INSTALL"] = "skip"
	if action == "test" || action == "verify" {
		for _, key := range []string{"POSTGRES_HOST", "PGVECTOR_TEST_URL", "AKASHA_WRITE_CONCURRENCY_TEST", "RUN_EVAL", "DATABASE_URL", "ARIADNE_SMOKE_DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_API_KEY"} {
			delete(env, key)
		}
	}
	return env
}

// LifecycleSteps receives the ordered module selection and does not execute it.
func LifecycleSteps(action string, modules []string) []Step {
	steps := []Step{}
	npm := func(name string, args ...string) {
		steps = append(steps, Step{Command: "npm", Args: args, CWD: "packages/" + name})
	}
	if action == "setup" {
		for _, name := range []string{"memory", "code"} {
			if slices.Contains(modules, name) {
				npm(name, "ci")
			}
		}
	}
	if action == "setup" || action == "build" {
		for _, name := range []string{"memory", "code"} {
			if slices.Contains(modules, name) {
				npm(name, "run", "build")
			}
		}
	}
	if action == "test" || action == "verify" {
		steps = append(steps, Step{Command: "node", Args: []string{"scripts/verify.mjs", "--modules", strings.Join(modules, ",")}, CWD: ""})
		if slices.Contains(modules, "memory") {
			npm("memory", "run", "typecheck")
			npm("memory", "test", "--", "--maxWorkers=1")
			if action == "verify" {
				npm("memory", "run", "audit:dependencies")
			}
		}
		if slices.Contains(modules, "code") {
			if action == "verify" {
				npm("code", "run", "verify")
			} else {
				npm("code", "test")
			}
		}
	}
	return steps
}
