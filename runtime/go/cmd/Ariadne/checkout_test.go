//go:build darwin || linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"debug/buildinfo"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

type checkoutResult struct {
	status         int
	stdout, stderr string
}

func checkoutMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func checkoutCopy(t *testing.T, source, target string) {
	t.Helper()
	in, err := os.Open(source)
	checkoutMust(t, err)
	defer in.Close()
	mode, err := in.Stat()
	checkoutMust(t, err)
	checkoutMust(t, os.MkdirAll(filepath.Dir(target), 0700))
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode.Mode().Perm())
	checkoutMust(t, err)
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	checkoutMust(t, errors.Join(err, closeErr))
}

func checkoutProcess(t *testing.T, timeout time.Duration, dir, name string, args ...string) *exec.Cmd {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), timeout)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	return cmd
}

func checkoutStart(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	checkoutMust(t, cmd.Start())
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			_ = cmd.Cancel()
			_ = cmd.Wait()
			checkoutCheckGone(t, cmd)
		}
	})
}

func checkoutCheckGone(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	if err := syscall.Kill(-cmd.Process.Pid, 0); !errors.Is(err, syscall.ESRCH) {
		killErr := cmd.Cancel()
		t.Errorf("process group %d remains after wait: probe %v, cleanup %v", cmd.Process.Pid, err, killErr)
	}
}

func checkoutExit(t *testing.T, cmd *exec.Cmd) int {
	t.Helper()
	err := cmd.Wait()
	checkoutCheckGone(t, cmd)
	var exited *exec.ExitError
	if err != nil && !errors.As(err, &exited) {
		t.Fatal(err)
	}
	if status := cmd.ProcessState.ExitCode(); status >= 0 {
		return status
	}
	t.Fatalf("launcher was terminated: %v", err)
	return -1
}

func checkoutRun(t *testing.T, cmd *exec.Cmd) checkoutResult {
	t.Helper()
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	checkoutStart(t, cmd)
	status := checkoutExit(t, cmd)
	return checkoutResult{status, out.String(), errOut.String()}
}

func TestCheckoutLauncher(t *testing.T) {
	source, err := filepath.Abs("../../../..")
	checkoutMust(t, err)
	area, err := filepath.EvalSymlinks(t.TempDir())
	checkoutMust(t, err)
	root := filepath.Join(area, "source ' checkout")
	caller := filepath.Join(area, "caller ' target")
	tools := filepath.Join(area, "tools")
	for _, dir := range []string{caller, tools, filepath.Join(root, "packages/memory"), filepath.Join(root, "packages/code")} {
		checkoutMust(t, os.MkdirAll(dir, 0700))
	}
	for _, name := range []string{"go.mod", "go.sum"} {
		checkoutCopy(t, filepath.Join(source, "runtime/go", name), filepath.Join(root, "runtime/go", name))
	}
	for _, dir := range []string{"cmd", "internal"} {
		checkoutMust(t, os.CopyFS(filepath.Join(root, "runtime/go", dir), os.DirFS(filepath.Join(source, "runtime/go", dir))))
	}
	for _, name := range []string{"bin/Ariadne.mjs", "core/domain/product.mjs", "core/application/product.mjs", "lib/command.mjs", "lib/module-selection.mjs", "lib/scrub.mjs", "scripts/product.mjs", "scripts/build-go-checkout.mjs"} {
		checkoutCopy(t, filepath.Join(source, name), filepath.Join(root, name))
	}
	nodeOutput, err := exec.Command("node", "-p", "process.execPath").Output()
	checkoutMust(t, err)
	node, err := filepath.EvalSymlinks(strings.TrimSuffix(string(nodeOutput), "\n"))
	checkoutMust(t, err)
	boundNode := filepath.Join(area, "local ' node")
	checkoutCopy(t, node, boundNode)
	alias := filepath.Join(area, "source link")
	checkoutMust(t, os.Symlink(root, alias))
	build := checkoutProcess(t, 3*time.Minute, caller, boundNode, "--preserve-symlinks-main", filepath.Join(alias, "scripts/build-go-checkout.mjs"), "../bound ' Ariadne")
	goExecutable := filepath.Join(runtime.GOROOT(), "bin/go")
	goEnvironment := filepath.Join(area, "go.env")
	const fixtureGCFlags = "ariadne/runtime/cmd/Ariadne=-N"
	checkoutMust(t, os.WriteFile(goEnvironment, []byte("GOARCH=wasm\nGOFLAGS=-gcflags="+fixtureGCFlags+"\n"), 0600))
	build.Env = append(build.Environ(), "PATH="+filepath.Dir(goExecutable)+string(os.PathListSeparator)+os.Getenv("PATH"),
		"GOARCH=wasm", "GOENV="+goEnvironment, "GOFLAGS=")
	if result := checkoutRun(t, build); result.status != 0 {
		t.Fatalf("build failed: %+v", result)
	}
	checkoutMust(t, os.Remove(alias))
	binary := filepath.Join(area, "bound ' Ariadne")
	info, err := buildinfo.ReadFile(binary)
	checkoutMust(t, err)
	settings := make(map[string]string)
	for _, setting := range info.Settings {
		settings[setting.Key] = setting.Value
	}
	if settings["GOOS"] != runtime.GOOS || settings["GOARCH"] != runtime.GOARCH || settings["-gcflags"] != fixtureGCFlags {
		t.Fatalf("build settings: got %s/%s -gcflags=%q, want %s/%s -gcflags=%q",
			settings["GOOS"], settings["GOARCH"], settings["-gcflags"], runtime.GOOS, runtime.GOARCH, fixtureGCFlags)
	}
	unbound := filepath.Join(area, "unbound Ariadne")
	if result := checkoutRun(t, checkoutProcess(t, 3*time.Minute, filepath.Join(root, "runtime/go"), goExecutable, "build", "-o", unbound, "./cmd/Ariadne")); result.status != 0 {
		t.Fatalf("unbound build failed: %+v", result)
	}
	// Keep installation and verification confined to the fixture, even if a
	// launcher accidentally attempts to resolve Node from PATH.
	checkoutMust(t, os.WriteFile(filepath.Join(tools, "node"), []byte("#!/bin/sh\nprintf 'unexpected PATH node\\n' >&2\nexit 98\n"), 0700))
	checkoutMust(t, os.Mkdir(filepath.Join(caller, "scripts"), 0700))
	checkoutMust(t, os.WriteFile(filepath.Join(caller, "scripts/product.mjs"), []byte("throw new Error('unexpected caller script')\n"), 0600))
	checkoutMust(t, os.WriteFile(filepath.Join(tools, "npm"), []byte(`#!/bin/sh
key=unset
if [ -n "$OPENAI_API_KEY" ]; then key="$OPENAI_API_KEY"; fi
printf 'npm %s %s %s %s\n' "$(pwd)" "$*" "$key" "$ONNXRUNTIME_NODE_INSTALL"
if [ "$*" = "$FIXTURE_FAIL_NPM" ]; then exit 17; fi
`), 0700))
	checkoutMust(t, os.WriteFile(filepath.Join(root, "scripts/verify.mjs"), []byte(`
console.log('verify fixture', process.cwd(), process.argv.slice(2).join(' '),
  process.env.OPENAI_API_KEY ?? 'unset', process.env.ONNXRUNTIME_NODE_INSTALL)
`), 0600))
	env := []string{"PATH=" + tools, "PWD=" + caller, "ARIADNE_ROOT=" + caller, "ARIADNE_NODE=" + filepath.Join(tools, "node"),
		"OPENAI_API_KEY=fixture-key", "FIXTURE_FAIL_NPM=run typecheck"}
	launch := func(t *testing.T, path string, args ...string) *exec.Cmd {
		cmd := checkoutProcess(t, 20*time.Second, caller, path, args...)
		cmd.Env = env
		return cmd
	}
	t.Run("original native commands", func(t *testing.T) {
		for _, args := range [][]string{{"--help"}, {"context", "--help"}, {"skills", "--help"}, {"ontology", "--help"}, {"extensions", "run"}, {"build"}, {"test"}} {
			got := checkoutRun(t, launch(t, binary, args...))
			want := checkoutRun(t, launch(t, unbound, args...))
			if got != want {
				t.Fatalf("%q changed: got %+v, want %+v", args, got, want)
			}
		}
		for _, action := range []string{"setup", "verify"} {
			if result := checkoutRun(t, launch(t, unbound, action)); result != (checkoutResult{2, "", "unsupported extensions command or option; use --help\n"}) {
				t.Fatalf("unbound %s: %+v", action, result)
			}
		}
	})
	t.Run("offline evaluation", func(t *testing.T) {
		for _, path := range []string{
			"core/domain/project-files.mjs", "core/infrastructure/project-files.mjs",
			"evaluation/compare-cli.mjs", "evaluation/comparison.mjs",
			"evaluation/memory-ablation-cli.mjs", "evaluation/memory-ablation.mjs",
		} {
			checkoutCopy(t, filepath.Join(source, path), filepath.Join(root, path))
		}
		checkoutMust(t, os.Mkdir(filepath.Join(caller, "evaluation"), 0700))
		for _, script := range []string{"compare-cli.mjs", "memory-ablation-cli.mjs"} {
			checkoutMust(t, os.WriteFile(filepath.Join(caller, "evaluation", script), []byte("process.exit(98)"), 0600))
		}
		checkoutCopy(t, filepath.Join(source, "evaluation/comparison-example.json"), filepath.Join(caller, "compare input.json"))
		checkoutCopy(t, filepath.Join(source, "evaluation/memory-ablation-example.json"), filepath.Join(caller, "records", "ablation.json"))
		for _, tc := range []struct {
			args   []string
			status int
		}{
			{[]string{"eval", "compare", "--file", "compare input.json"}, 0},
			{[]string{"eval", "memory-ablation", "--root", "records", "--file", "ablation.json"}, 0},
			{[]string{"eval", "compare", "--file", "../outside.json"}, 2},
			{[]string{"eval", "memory-ablation"}, 2},
			{[]string{"eval"}, 2},
			{[]string{"eval", "constructor"}, 2},
		} {
			want := checkoutRun(t, launch(t, node, append([]string{filepath.Join(root, "bin/Ariadne.mjs")}, tc.args...)...))
			got := checkoutRun(t, launch(t, binary, tc.args...))
			if want.status != tc.status || got != want || (tc.status == 0 && !json.Valid([]byte(got.stdout))) {
				t.Fatalf("%q: Node status %d, Go status %d, stdout equal %t; Node stderr %q; Go stderr %q", tc.args, want.status, got.status, want.stdout == got.stdout, want.stderr, got.stderr)
			}
		}
		if result := checkoutRun(t, launch(t, unbound, "eval", "compare", "--file", "compare input.json")); result != (checkoutResult{2, "", "unsupported extensions command or option; use --help\n"}) {
			t.Fatalf("unbound eval: %+v", result)
		}
	})
	t.Run("existing lifecycle policy", func(t *testing.T) {
		memory, code := filepath.Join(root, "packages/memory"), filepath.Join(root, "packages/code")
		for _, c := range []struct {
			args   []string
			status int
			out    string
		}{
			{[]string{"setup", "--modules", "code"}, 0,
				"product: setup modules=core,code\nnpm " + code + " ci fixture-key skip\nnpm " + code + " run build fixture-key skip\nproduct: setup complete modules=core,code\n"},
			{[]string{"setup"}, 0,
				"product: setup modules=core,memory,code,ontology\nnpm " + memory + " ci fixture-key skip\nnpm " + code + " ci fixture-key skip\nnpm " + memory + " run build fixture-key skip\nnpm " + code + " run build fixture-key skip\nproduct: setup complete modules=core,memory,code,ontology\n"},
			{[]string{"verify", "--modules=memory,ontology"}, 17,
				"product: verify modules=core,memory,ontology\nverify fixture " + root + " --modules core,memory,ontology unset skip\nnpm " + memory + " run typecheck unset skip\n"},
			{[]string{"verify", "--modules", "core,ontology"}, 0,
				"product: verify modules=core,ontology\nverify fixture " + root + " --modules core,ontology unset skip\nproduct: verify complete modules=core,ontology\n"},
			{[]string{"verify", "--root", caller}, 2, ""},
			{[]string{"setup", "--modules", ""}, 2, ""},
		} {
			want := checkoutRun(t, launch(t, node, append([]string{filepath.Join(root, "bin/Ariadne.mjs")}, c.args...)...))
			got := checkoutRun(t, launch(t, binary, c.args...))
			if got != want || got.status != c.status || got.stdout != c.out {
				t.Fatalf("%q: native %+v; Node %+v; expected status %d stdout %q", c.args, got, want, c.status, c.out)
			}
		}
		checkoutMust(t, os.Remove(filepath.Join(tools, "npm")))
		args := []string{"setup", "--modules=code"}
		want := checkoutRun(t, launch(t, node, append([]string{filepath.Join(root, "bin/Ariadne.mjs")}, args...)...))
		got := checkoutRun(t, launch(t, binary, args...))
		if got != want || got.status != 1 || !strings.Contains(got.stderr, "spawn npm ENOENT") {
			t.Fatalf("npm spawn failure: native %+v; Node %+v", got, want)
		}
	})
	productScript := filepath.Join(root, "scripts/product.mjs")
	t.Run("stdio and authority", func(t *testing.T) {
		checkoutMust(t, os.WriteFile(productScript, []byte(`
import { readFileSync } from 'node:fs'
console.log(JSON.stringify([process.cwd(), process.execPath, process.env.PWD, process.env.OPENAI_API_KEY,
  readFileSync(0, 'utf8'), ...process.argv.slice(1)]))
console.error('fixture stderr')
process.exitCode = 27
`), 0600))
		cmd := launch(t, binary, "setup", "arg with spaces", "arg'one", "", "--node", "nobody")
		cmd.Stdin = strings.NewReader("pipe input\n")
		got := checkoutRun(t, cmd)
		want, err := json.Marshal([]string{root, boundNode, caller, "fixture-key", "pipe input\n", productScript, "setup", "arg with spaces", "arg'one", "", "--node", "nobody"})
		checkoutMust(t, err)
		if got != (checkoutResult{27, string(want) + "\n", "fixture stderr\n"}) {
			t.Fatalf("stdio and authority: %+v, expected stdout %s", got, want)
		}
	})
	t.Run("signals", func(t *testing.T) {
		checkoutMust(t, os.WriteFile(productScript, []byte(`
import { writeSync } from 'node:fs'
if (process.argv[3] === 'handled') {
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => setTimeout(() => {
    writeSync(1, sig + ' cleanup\n')
    process.exit(0)
  }, 30))
}
writeSync(1, 'ready\n')
setInterval(() => {}, 1000)
`), 0600))
		for _, signal := range []struct {
			value syscall.Signal
			name  string
		}{{syscall.SIGINT, "SIGINT"}, {syscall.SIGTERM, "SIGTERM"}} {
			for _, mode := range []string{"handled", "default"} {
				t.Run(signal.name+"/"+mode, func(t *testing.T) {
					cmd := launch(t, binary, "verify", mode)
					var errOut bytes.Buffer
					cmd.Stderr = &errOut
					pipe, err := cmd.StdoutPipe()
					checkoutMust(t, err)
					checkoutStart(t, cmd)
					out := bufio.NewReader(pipe)
					ready, err := out.ReadString('\n')
					if err != nil || ready != "ready\n" {
						t.Fatalf("child did not announce readiness: %q, %v", ready, err)
					}
					checkoutMust(t, cmd.Process.Signal(signal.value))
					rest, err := io.ReadAll(out)
					checkoutMust(t, err)
					wantStatus, wantOut := 128+int(signal.value), ""
					if mode == "handled" {
						wantStatus, wantOut = 0, signal.name+" cleanup\n"
					}
					if status := checkoutExit(t, cmd); status != wantStatus || string(rest) != wantOut || errOut.Len() != 0 {
						t.Fatalf("exit %d (want %d), stdout %q (want %q), stderr %q", status, wantStatus, rest, wantOut, errOut.String())
					}
				})
			}
		}
	})
	t.Run("bound Node start failure", func(t *testing.T) {
		checkoutMust(t, os.Remove(boundNode))
		// Point the Node CLI's next spawn at the same unavailable executable.
		path, err := json.Marshal(boundNode)
		checkoutMust(t, err)
		preload := filepath.Join(caller, "unavailable-node.mjs")
		checkoutMust(t, os.WriteFile(preload, append([]byte("process.execPath = "), path...), 0600))
		want := checkoutRun(t, launch(t, node, "--import", preload, filepath.Join(root, "bin/Ariadne.mjs"), "setup", "--modules=core"))
		got := checkoutRun(t, launch(t, binary, "setup", "--modules=core"))
		if want.status != 2 || want.stdout != "" || !strings.Contains(want.stderr, "ENOENT") ||
			got.status != want.status || got.stdout != want.stdout || !strings.Contains(got.stderr, "Ariadne: could not start checkout Node:") ||
			!strings.Contains(got.stderr, syscall.ENOENT.Error()) {
			t.Fatalf("bound Node start failure: native %+v; Node %+v", got, want)
		}
	})
}
