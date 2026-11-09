package composition

import (
	"encoding/json"
	"fmt"
	"io"

	evaluation "ariadne/runtime/internal/evaluation/application"
	"ariadne/runtime/internal/extensions/adapters/files"
	extensions "ariadne/runtime/internal/extensions/application"
)

// Run exposes E0 inspection and the trusted reference projector, never user execution.
func Run(args []string, out, errOut io.Writer) int {
	if len(args) == 1 && args[0] == "--help" {
		fmt.Fprintln(out, "Experimental E0: extensions inspect --package DIR | project --input FILE | environment --info FILE")
		return 0
	}
	if len(args) != 4 || args[0] != "extensions" {
		fmt.Fprintln(errOut, "expected extensions inspect --package DIR, project --input FILE, or environment --info FILE")
		return 2
	}
	var result any
	var err error
	switch {
	case args[1] == "inspect" && args[2] == "--package":
		result, err = files.Inspect(args[3])
	case args[1] == "project" && args[2] == "--input":
		var data []byte
		data, err = files.ReadInput(args[3], 1<<20)
		if err == nil {
			var input extensions.ProjectionInput
			input, err = extensions.ParseProjectionInput(data)
			if err == nil {
				result, err = evaluation.ProjectReport(input)
			}
		}
	case args[1] == "environment" && args[2] == "--info":
		var data []byte
		data, err = files.ReadInput(args[3], 1<<20)
		if err == nil {
			result, err = extensions.AssessEnvironment(data)
		}
	default:
		fmt.Fprintln(errOut, "unsupported E0 command or option")
		return 2
	}
	if err != nil {
		fmt.Fprintln(errOut, "extensions:", err)
		return 1
	}
	if err := json.NewEncoder(out).Encode(result); err != nil {
		fmt.Fprintln(errOut, "extensions: output unavailable")
		return 1
	}
	return 0
}
