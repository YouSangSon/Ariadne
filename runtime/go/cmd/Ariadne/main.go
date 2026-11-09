package main

import (
	"ariadne/runtime/internal/composition"
	"os"
)

func main() { os.Exit(composition.Run(os.Args[1:], os.Stdout, os.Stderr)) }
