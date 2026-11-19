package main

import (
	"ariadne/runtime/internal/composition"
	"os"
)

func main() {
	args := os.Args[1:]
	if status, handled := runCheckout(args); handled {
		os.Exit(status)
	}
	os.Exit(composition.Run(args, os.Stdout, os.Stderr))
}
