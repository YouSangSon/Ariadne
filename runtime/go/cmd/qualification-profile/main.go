package main

import (
	"ariadne/runtime/internal/extensions/adapters/podman"
	"encoding/json"
	"fmt"
	"os"
)

// This tooling emits fixed args for the qualification harness; it runs no container.
func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "expected qualification name and immutable image ID")
		os.Exit(2)
	}
	args, err := podman.ProfileArgs(os.Args[1], os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if err := json.NewEncoder(os.Stdout).Encode(args); err != nil {
		os.Exit(1)
	}
}
