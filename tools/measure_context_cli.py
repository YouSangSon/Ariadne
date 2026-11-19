#!/usr/bin/env python3
"""Measure the two fixed Context cases on macOS. See docs/context-cli-baseline.ko.md."""

import argparse
from contextlib import suppress
from hashlib import sha256
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from tempfile import TemporaryFile
from time import perf_counter_ns


REPO = Path(__file__).resolve().parents[1]
FIXTURE_SOURCE = "0808fc65168fbef66ec534d41e3f03d2b7236892"
SKILL = "skills/context/SKILL.md"
INPUTS = (".harness/reqs/go-context-files.yaml", ".harness/decisions.md", SKILL)
CASES = {"standard": [], "brief-rejection": ["--budget", "brief"]}
EMPTY = {"bytes": 0, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
GOLDEN = {
    "standard": {
        "status": 0, "stderr": EMPTY,
        "stdout": {"bytes": 9656, "sha256": "231bd563930759bce8ad8b7ed4f61e68c17438735b92620a9423c07d7cca1dbd"},
    },
    "brief-rejection": {
        "status": 1, "stdout": EMPTY,
        "stderr": {"bytes": 129, "sha256": "e205f74d84ff4db534f6c1981a11dc7fd43107156e4deea1b5ebd71f91614693"},
    },
}


def fingerprint(data):
    return {"bytes": len(data), "sha256": sha256(data).hexdigest()}


def signature(result):
    status, output, error = result
    return {"status": status, "stdout": fingerprint(output), "stderr": fingerprint(error)}


def fixture(root, inputs):
    for relative, content in inputs.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as file:
            file.write(content)


def check_group(pid):
    try:
        os.killpg(pid, 0)
    except ProcessLookupError:
        return
    raise RuntimeError(f"process group {pid} is still present; inspect before removing scratch")


class Runner:
    def __init__(self, scratch):
        self.scratch = scratch
        self.env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "HOME": str(scratch), "TMPDIR": str(scratch)}
        self.waiting = False
        self.stop_signal = None

    def interrupt(self, number, _frame):
        if number == signal.SIGALRM:
            if self.waiting:
                raise TimeoutError("executable did not exit before the deadline")
            return
        self.stop_signal = number
        if self.waiting:
            self.check_interrupt()

    def check_interrupt(self):
        if self.stop_signal is not None:
            raise InterruptedError(f"received {signal.Signals(self.stop_signal).name}")

    def capture(self, argv, cwd, *, timed=False, timeout=10):
        self.check_interrupt()
        with TemporaryFile(dir=self.scratch) as out, TemporaryFile(dir=self.scratch) as err:
            started = perf_counter_ns() if timed else None
            child = subprocess.Popen(
                argv, cwd=cwd, env=self.env, stdin=subprocess.DEVNULL, stdout=out,
                stderr=err, start_new_session=True,
            )
            try:
                try:
                    self.waiting = True
                    self.check_interrupt()
                    signal.setitimer(signal.ITIMER_REAL, timeout)
                    # Observe exit without reaping so an interrupt cannot leave cleanup with a reused PID.
                    os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOWAIT)
                finally:
                    self.waiting = False
                    signal.setitimer(signal.ITIMER_REAL, 0)
            except BaseException:
                with suppress(ProcessLookupError):
                    os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
                check_group(child.pid)
                raise
            _, status, usage = os.wait4(child.pid, 0)
            elapsed = perf_counter_ns() - started if timed else None
            child.returncode = os.waitstatus_to_exitcode(status)
            check_group(child.pid)
            self.check_interrupt()
            out.seek(0)
            err.seek(0)
            result = (child.returncode, out.read(), err.read())
            if not timed:
                return result, None
            user = round(usage.ru_utime * 1_000_000)
            system = round(usage.ru_stime * 1_000_000)
            stats = {"wall_ns": elapsed, "user_us": user, "system_us": system,
                     "cpu_us": user + system, "max_rss_bytes": usage.ru_maxrss}
            return result, stats


def summarize(samples):
    def distribution(values):
        values = sorted(values)
        count = len(values)
        return {
            "n": count, "p50": values[(50 * count + 99) // 100 - 1],
            "p95": values[(95 * count + 99) // 100 - 1], "min": values[0], "max": values[-1],
        }

    return {key: distribution(row[key] for row in samples) for key in ("wall_ns", "cpu_us", "max_rss_bytes")}


def run_suite(args, runner, report, inputs):
    commands = {
        "node": [args.node, REPO / "bin/Ariadne.mjs", "context"],
        "go": [args.go, "context"],
    }
    skill = sha256(inputs[SKILL]).hexdigest()
    common = ["--req", "go-context-files", "--skill", f"context@{skill}"]
    preflight = runner.scratch / "preflight"
    fixture(preflight, inputs)
    reference = {}
    for case, flags in CASES.items():
        for label, command in commands.items():
            result, _ = runner.capture(command + common + flags, preflight)
            observed = signature(result)
            report["preflight"].setdefault(case, {})[label] = observed
            if label == "node":
                reference[case] = result
            if observed != GOLDEN[case] or result != reference[case]:
                raise ValueError(f"{case} / {label} differs from the expected result")
    if args.check:
        return

    def pair(phase, index, case, node_first):
        cwd = runner.scratch / case
        labels = ("node", "go") if node_first else ("go", "node")
        timed = phase != "warmup"
        for label in labels:
            result, stats = runner.capture(commands[label] + common + CASES[case], cwd, timed=timed)
            if result != reference[case]:
                raise ValueError(f"{phase} {index} / {case} / {label} differs from preflight: {signature(result)}")
            if timed:
                report["samples"].append({"phase": phase, "case": case, "pair": index, "backend": label, **stats})

    for index, case in enumerate(CASES):
        fixture(runner.scratch / case, inputs)
        pair("first", 1, case, index == 0)
    for phase, count in (("warmup", 2), ("warm", 60)):
        for index in range(count):
            forward = index % 2 == 0
            for case in CASES if forward else reversed(CASES):
                node_first = forward == (case == "standard")
                pair(phase, index + 1, case, node_first)

    for case in CASES:
        for label in commands:
            rows = [row for row in report["samples"] if (row["phase"], row["case"], row["backend"]) == ("warm", case, label)]
            report["summary"].setdefault(case, {})[label] = summarize(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--go", required=True, type=Path)
    parser.add_argument("--scratch", required=True, type=Path, help="existing empty private directory")
    parser.add_argument("--check", action="store_true", help="only compare the actual CLI results")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("the resource protocol requires macOS")
    for key in ("node", "go", "scratch"):
        setattr(args, key, getattr(args, key).resolve(strict=True))
    if not args.scratch.is_dir() or any(args.scratch.iterdir()):
        parser.error("--scratch must be an empty private directory")

    runner = Runner(args.scratch)
    for number in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM):
        signal.signal(number, runner.interrupt)
    inputs = {
        path: subprocess.run(["git", "show", f"{FIXTURE_SOURCE}:{path}"], cwd=REPO,
                             check=True, stdout=subprocess.PIPE).stdout
        for path in INPUTS
    }
    report = {
        "fixture_source": FIXTURE_SOURCE,
        "fixture": {path: fingerprint(content) for path, content in inputs.items()},
        "preflight": {}, "samples": [], "summary": {}, "error": None,
    }
    try:
        run_suite(args, runner, report, inputs)
    except BaseException as error:
        report["error"] = str(error)
        raise
    finally:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
