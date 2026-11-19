package composition

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	contextcli "ariadne/runtime/internal/context/adapters/cli"
	contextfiles "ariadne/runtime/internal/context/adapters/files"
	contextapp "ariadne/runtime/internal/context/application"
	corefiles "ariadne/runtime/internal/core/adapters/files"
	evaluation "ariadne/runtime/internal/evaluation/application"
	"ariadne/runtime/internal/extensions/adapters/files"
	"ariadne/runtime/internal/extensions/adapters/sqlite"
	extensions "ariadne/runtime/internal/extensions/application"
	"ariadne/runtime/internal/extensions/domain"
	ontologycli "ariadne/runtime/internal/ontology/adapters/cli"
	ontologyfiles "ariadne/runtime/internal/ontology/adapters/files"
	ontologyapp "ariadne/runtime/internal/ontology/application"
)

const help = `Experimental read-only context: context [--root DIR] [--req SLUG] [--budget NAME] [--skill SLUG@SHA256]; skills [--root DIR]
Experimental read-only ontology: ontology inspect|search (use ontology --help)
Experimental nonexecuting extensions:
 extensions inspect --package DIR
 extensions inspect ID [--workspace DIR]
 extensions install --package DIR [--workspace DIR]
 extensions activate ID --digest SHA256 --expected-revision N [--workspace DIR]
 extensions disable ID --expected-revision N [--workspace DIR]
 extensions remove ID --digest SHA256 --expected-revision N [--workspace DIR]
 extensions project --input FILE
 extensions environment --info FILE
Activation selects a package only. Runtime qualification and user execution are unavailable.`

type arguments struct {
	command, id string
	flags       map[string]string
	revision    int64
}

func parse(args []string) (arguments, bool) {
	a := arguments{flags: map[string]string{}}
	if len(args) < 2 || args[0] != "extensions" {
		return a, false
	}
	a.command = args[1]
	allowed := map[string]bool{}
	positional := false
	switch a.command {
	case "project":
		allowed["--input"] = true
	case "environment":
		allowed["--info"] = true
	case "install":
		allowed["--package"] = true
		allowed["--workspace"] = true
	case "inspect":
		allowed["--package"] = true
		allowed["--workspace"] = true
		positional = true
	case "activate", "remove":
		allowed["--digest"] = true
		allowed["--expected-revision"] = true
		allowed["--workspace"] = true
		positional = true
	case "disable":
		allowed["--expected-revision"] = true
		allowed["--workspace"] = true
		positional = true
	default:
		return a, false
	}
	for i := 2; i < len(args); i++ {
		value := args[i]
		if strings.HasPrefix(value, "--") {
			if !allowed[value] || a.flags[value] != "" || i+1 >= len(args) || args[i+1] == "" || strings.HasPrefix(args[i+1], "--") {
				return a, false
			}
			i++
			a.flags[value] = args[i]
		} else {
			if !positional || a.id != "" {
				return a, false
			}
			a.id = value
		}
	}
	if positional {
		if a.command == "inspect" && a.flags["--package"] != "" {
			if a.id != "" || a.flags["--workspace"] != "" {
				return a, false
			}
		} else if !domain.ValidID(a.id) {
			return a, false
		}
	}
	if (a.command == "install" && a.flags["--package"] == "") || (a.command == "project" && a.flags["--input"] == "") || (a.command == "environment" && a.flags["--info"] == "") {
		return a, false
	}
	if a.command == "activate" || a.command == "remove" {
		if !domain.ValidDigest(a.flags["--digest"]) {
			return a, false
		}
	}
	if allowed["--expected-revision"] {
		raw := a.flags["--expected-revision"]
		if raw == "" || strings.IndexFunc(raw, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return a, false
		}
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return a, false
		}
		a.revision = n
	}
	return a, true
}
func Run(args []string, out, errOut io.Writer) int {
	if len(args) > 0 && args[0] == "context" {
		return contextcli.RunContext(args[1:], out, errOut, func(root string) contextapp.PackStore { return contextfiles.New(root, corefiles.Reader{}) })
	}
	if len(args) > 0 && args[0] == "skills" {
		return contextcli.RunSkills(args[1:], out, errOut, func(root string) contextapp.CatalogStore { return contextfiles.New(root, corefiles.Reader{}) })
	}
	if len(args) > 0 && args[0] == "ontology" {
		return ontologycli.Run(args[1:], out, errOut, func(file string) (ontologyapp.Ports, error) { return ontologyfiles.New(file, corefiles.Reader{}) })
	}
	if len(args) == 1 && args[0] == "--help" {
		fmt.Fprintln(out, help)
		return 0
	}
	a, ok := parse(args)
	if !ok {
		fmt.Fprintln(errOut, "unsupported extensions command or option; use --help")
		return 2
	}
	var result any
	var err error
	switch a.command {
	case "project", "environment":
		flag := "--input"
		if a.command == "environment" {
			flag = "--info"
		}
		var data []byte
		data, err = files.ReadInput(a.flags[flag], 1<<20)
		if err == nil {
			if a.command == "environment" {
				result, err = extensions.AssessEnvironment(data)
			} else {
				var input extensions.ProjectionInput
				input, err = extensions.ParseProjectionInput(data)
				if err == nil {
					result, err = evaluation.ProjectReport(input)
				}
			}
		}
	case "inspect":
		if a.flags["--package"] != "" {
			result, err = files.Inspect(a.flags["--package"])
			break
		}
		fallthrough
	default:
		var snapshot domain.PackageSnapshot
		if a.command == "install" {
			snapshot, err = (files.Reader{}).ReadPackage(a.flags["--package"])
			if err != nil {
				break
			}
		}
		workspace := a.flags["--workspace"]
		if workspace == "" {
			workspace, err = os.Getwd()
			if err != nil {
				err = domain.RegistryUntrusted
				break
			}
		}
		var store *sqlite.Store
		store, err = sqlite.Open(workspace, a.command == "install")
		if err != nil {
			break
		}
		defer store.Close()
		ctx := context.Background()
		switch a.command {
		case "inspect":
			result, err = store.Inspect(ctx, a.id)
		case "install":
			result, err = store.Install(ctx, snapshot)
		case "activate":
			result, err = store.Activate(ctx, a.id, a.flags["--digest"], a.revision)
		case "disable":
			result, err = store.Disable(ctx, a.id, a.revision)
		case "remove":
			result, err = store.Remove(ctx, a.id, a.flags["--digest"], a.revision)
		}
	}
	if err != nil {
		fmt.Fprintln(errOut, "extensions:", err)
		return 1
	}
	if err = json.NewEncoder(out).Encode(result); err != nil {
		fmt.Fprintln(errOut, "extensions: output unavailable")
		return 1
	}
	return 0
}
