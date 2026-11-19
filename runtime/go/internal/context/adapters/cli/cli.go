package contextcli

import (
	contextjson "ariadne/runtime/internal/context/adapters/json"
	contextapp "ariadne/runtime/internal/context/application"
	"ariadne/runtime/internal/context/domain"
	coreapp "ariadne/runtime/internal/core/application"
	"errors"
	"fmt"
	"golang.org/x/text/encoding/unicode"
	"io"
	"strings"
)

type PackFactory func(string) contextapp.PackStore
type CatalogFactory func(string) contextapp.CatalogStore

// OS argv is bytes on Unix; Node decodes maximal malformed UTF-8 subparts first.
func argv(raw []string) []string {
	args := make([]string, len(raw))
	for i, s := range raw {
		args[i], _ = unicode.UTF8.NewDecoder().String(s)
	}
	return args
}
func rootOrCwd(options map[string]string) (string, error) {
	if root, ok := options["--root"]; ok {
		return root, nil
	}
	return cwd()
}
func failure(out io.Writer, prefix string, err error, code int) int {
	raw, _ := unicode.UTF8.NewDecoder().String(err.Error())
	text := domain.NewText(coreapp.Scrub(domain.FromString(raw).Units()))
	fmt.Fprintln(out, prefix+": "+text.String())
	return code
}

func RunContext(raw []string, out, errOut io.Writer, newStore PackFactory) int {
	args := argv(raw)
	options := map[string]string{}
	skills := []string{}
	fail := func(err error) int { return failure(errOut, "context-pack", err, 1) }
	for i := 0; i < len(args); i++ {
		name := args[i]
		if name != "--root" && name != "--req" && name != "--budget" && name != "--skill" {
			return fail(fmt.Errorf("unknown context option: %s", name))
		}
		i++
		if i == len(args) || args[i] == "" || strings.HasPrefix(args[i], "--") {
			return fail(fmt.Errorf("%s: 값이 필요하다", name))
		}
		if name == "--skill" {
			skills = append(skills, args[i])
			continue
		}
		if _, ok := options[name]; ok {
			return fail(fmt.Errorf("duplicate context option: %s", name))
		}
		options[name] = args[i]
	}
	root, err := rootOrCwd(options)
	if err != nil {
		return fail(err)
	}
	opts := contextapp.BuildOptions{Budget: options["--budget"], Skills: skills}
	if req, ok := options["--req"]; ok {
		opts.ReqSlug = &req
	}
	text, err := contextapp.BuildPack(newStore(root), opts)
	if err != nil {
		return fail(err)
	}
	if _, err = io.WriteString(out, text.String()); err != nil {
		return fail(err)
	}
	return 0
}
func RunSkills(raw []string, out, errOut io.Writer, newStore CatalogFactory) int {
	args := argv(raw)
	fail := func(err error) int { return failure(errOut, "skills", err, 2) }
	options := map[string]string{}
	if len(args) > 0 {
		if len(args) != 2 || args[0] != "--root" || args[1] == "" || strings.HasPrefix(args[1], "--") {
			return fail(errors.New("usage: Ariadne skills [--root path]"))
		}
		options["--root"] = args[1]
	}
	root, err := rootOrCwd(options)
	if err != nil {
		return fail(err)
	}
	catalog, err := contextapp.SkillCatalog(newStore(root))
	if err != nil {
		return fail(err)
	}
	data, err := contextjson.EncodeCatalog(catalog)
	if err != nil {
		return fail(err)
	}
	if _, err = out.Write(data); err != nil {
		return fail(err)
	}
	return 0
}
