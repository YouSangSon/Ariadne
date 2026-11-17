package ontologycli

import (
	coreapp "ariadne/runtime/internal/core/application"
	ontologyjson "ariadne/runtime/internal/ontology/adapters/json"
	ontologyapp "ariadne/runtime/internal/ontology/application"
	ontology "ariadne/runtime/internal/ontology/domain"
	"errors"
	"fmt"
	"golang.org/x/text/encoding/unicode"
	"io"
	"strconv"
	"strings"
)

const Usage = `Ariadne ontology inspect --file ontology.json
Ariadne ontology search --file ontology.json --query text [--limit 5]
Read-only local vocabulary lookup. No model, SQL execution or factual answerability claim.`

type Factory func(string) (ontologyapp.Ports, error)

func parse(command string, args []string) (map[string]string, error) {
	values := map[string]string{}
	seen := map[string]bool{}
	duplicate := false
	ended := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !ended && arg == "--" {
			ended = true
			continue
		}
		if ended || arg == "-" || !strings.HasPrefix(arg, "-") {
			return nil, fmt.Errorf("Unexpected argument '%s'. This command does not take positional arguments", arg)
		}
		raw := arg
		if strings.HasPrefix(raw, "--") {
			if j := strings.IndexByte(raw, '='); j >= 0 {
				raw = raw[:j]
			}
		} else {
			raw = ontology.NewText(ontology.FromString(raw).Units()[:2]).String()
		}
		name := strings.TrimPrefix(raw, "--")
		if raw != "--file" && !(command == "search" && (raw == "--query" || raw == "--limit")) {
			return nil, fmt.Errorf("Unknown option '%s'", raw)
		}
		value := ""
		if len(arg) > len(raw) && arg[len(raw)] == '=' {
			value = arg[len(raw)+1:]
		} else {
			if i+1 == len(args) {
				return nil, fmt.Errorf("Option '%s <value>' argument missing", raw)
			}
			i++
			value = args[i]
			if len(value) > 1 && strings.HasPrefix(value, "-") {
				return nil, fmt.Errorf("Option '%s' argument is ambiguous.\nDid you forget to specify the option argument for '%s'?\nTo specify an option argument starting with a dash use '%s=-XYZ'.", raw, raw, raw)
			}
		}
		duplicate = duplicate || seen[name]
		seen[name] = true
		values[name] = value
	}
	if duplicate {
		return nil, errors.New("Duplicate ontology option")
	}
	if ontology.FromString(values["file"]).Trim().Len() == 0 || command == "search" && ontology.FromString(values["query"]).Trim().Len() == 0 {
		return nil, errors.New(Usage)
	}
	if value, ok := values["limit"]; ok {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > 20 || strconv.Itoa(n) != value {
			return nil, errors.New("limit must be an integer from 1 to 20")
		}
	}
	return values, nil
}
func Run(args []string, out, errOut io.Writer, newPorts Factory) int {
	decoded := make([]string, len(args))
	for i, value := range args {
		decoded[i], _ = unicode.UTF8.NewDecoder().String(value)
	}
	args = decoded
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		if _, err := fmt.Fprintln(out, Usage); err == nil {
			return 0
		}
		return 2
	}
	fail := func(err error) int {
		text := ontology.NewText(coreapp.Scrub(ontology.FromString(err.Error()).Units())).String()
		fmt.Fprintln(errOut, "Ariadne ontology: "+text)
		return 2
	}
	command := args[0]
	if command != "inspect" && command != "search" {
		return fail(errors.New(Usage))
	}
	values, err := parse(command, args[1:])
	if err != nil {
		return fail(err)
	}
	ports, err := newPorts(values["file"])
	if err != nil {
		return fail(err)
	}
	snapshot, err := ontologyapp.LoadOntology(ports)
	if err != nil {
		return fail(err)
	}
	var result []byte
	if command == "inspect" {
		result, err = ontologyjson.EncodeInspection(ontologyapp.InspectOntology(snapshot))
	} else {
		limit := ontology.Limit{}
		if value, ok := values["limit"]; ok {
			n, _ := strconv.Atoi(value)
			limit = ontology.Limit{Present: true, Value: float64(n)}
		}
		search, e := ontologyapp.SearchOntology(snapshot, ontology.FromString(values["query"]), limit)
		err = e
		if err == nil {
			result, err = ontologyjson.EncodeSearch(search)
		}
	}
	if err != nil {
		return fail(err)
	}
	if _, err = out.Write(result); err != nil {
		return fail(err)
	}
	return 0
}
