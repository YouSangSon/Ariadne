//go:build darwin || linux

package main

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"unicode/utf16"

	coreapp "ariadne/runtime/internal/core/application"
	"ariadne/runtime/internal/core/domain/product"
)

// Set only by scripts/build-go-checkout.mjs for a local checkout build.
var checkoutRootHex, checkoutNodeHex string

func runCheckout(args []string) (int, bool) {
	if checkoutRootHex == "" && checkoutNodeHex == "" || len(args) == 0 || (args[0] != "setup" && args[0] != "verify") {
		return 0, false
	}
	root, rootErr := hex.DecodeString(checkoutRootHex)
	node, nodeErr := hex.DecodeString(checkoutNodeHex)
	if rootErr != nil || nodeErr != nil || !filepath.IsAbs(string(root)) || !filepath.IsAbs(string(node)) {
		fmt.Fprintln(os.Stderr, "Ariadne: invalid checkout launcher build paths")
		return 2, true
	}
	plan, err := product.CommandPlan(args[0], args[1:], "")
	if err != nil || plan.Kind != "process" || plan.Command != "node" || plan.Path != "scripts/product.mjs" ||
		plan.CWD == nil || *plan.CWD != "" || plan.Module != "" || plan.InstallRoot {
		fmt.Fprintln(os.Stderr, "Ariadne: invalid checkout lifecycle command plan")
		return 2, true
	}
	child := exec.Command(string(node), append([]string{filepath.Join(string(root), plan.Path)}, plan.Args...)...)
	child.Dir = string(root)
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
	// A nil Env would let os/exec rewrite PWD to the child's working directory.
	child.Env = os.Environ()
	return waitForCheckoutChild(child), true
}

func waitForCheckoutChild(child *exec.Cmd) int {
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	if err := child.Start(); err != nil {
		return checkoutProcessError("start", err)
	}
	finished := make(chan error, 1)
	go func() { finished <- child.Wait() }()
	for {
		select {
		case sig := <-signals:
			_ = child.Process.Signal(sig)
		case err := <-finished:
			if err == nil {
				return 0
			}
			var exit *exec.ExitError
			if !errors.As(err, &exit) {
				return checkoutProcessError("wait for", err)
			}
			status := exit.Sys().(syscall.WaitStatus)
			if status.Signaled() {
				return 128 + int(status.Signal())
			}
			return exit.ExitCode()
		}
	}
}

func checkoutProcessError(action string, err error) int {
	message := string(utf16.Decode(coreapp.Scrub(utf16.Encode([]rune(err.Error())))))
	fmt.Fprintf(os.Stderr, "Ariadne: could not %s checkout Node: %s\n", action, message)
	return 2
}
