package main

import (
	"flag"
	"fmt"
	"os"

	"ariadne/runtime/internal/architecture"
)

func main() {
	root := flag.String("root", "../..", "repository root containing architecture-map.json")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: check-architecture --root <repository>")
		os.Exit(2)
	}
	violations, err := architecture.Check(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, violation := range violations {
		fmt.Fprintln(os.Stderr, violation)
	}
	if len(violations) != 0 {
		os.Exit(1)
	}
	fmt.Println("Go architecture boundaries passed")
}
