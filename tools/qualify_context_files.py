"""Pair the actual experimental Go executable with the pinned, offline Node CLI."""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import shutil
import subprocess
import sys
import tempfile
import time


def completed(command, cwd, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, timeout=20, check=False)
    return {"status": result.returncode, "stdout_hex": result.stdout.hex(), "stderr_hex": result.stderr.hex()}


@contextmanager
def registered_startup():
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)


def settle(process):
    if process is None:
        return
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.communicate(timeout=5)
    record = {"pgid": process.pid, "waited": True, "observation_errors": []}
    end = time.monotonic() + 2
    while True:
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            record["state"] = "observed absent"
            return record
        except OSError as error:
            message = str(error)
            if message not in record["observation_errors"]:
                record["observation_errors"].append(message)
        if time.monotonic() >= end:
            raise AssertionError(f"owned child group not observed absent after Wait: {record}")
        time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go-cli", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    interrupted = False
    cleaning = False

    def interrupt(_signum, _frame):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            if not cleaning:
                raise KeyboardInterrupt

    for sig in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(sig, interrupt)
    assert sys.platform == "darwin" or sys.platform.startswith("linux"), sys.platform
    root = Path(__file__).resolve().parents[1]
    binary = args.go_cli.resolve(strict=True)
    args.scratch.mkdir(parents=True, exist_ok=True)
    profile = json.loads(subprocess.check_output([args.node, "-p", "JSON.stringify({node:process.version,icu:process.versions.icu,unicode:process.versions.unicode})"], cwd=root))
    assert profile == {"node": "v24.22.2", "icu": "78.3", "unicode": "17.0"}, profile
    assert platform.python_version() == "3.14.5", platform.python_version()
    corpus = json.loads((root / "contracts/context/files-cli-v1/cases.json").read_text())
    source = {
        "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=root, text=True).strip(),
        "working_diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD", "--binary"], cwd=root)).hexdigest(),
        "go_source_sha256": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root / "runtime/go").rglob("*.go"))},
        "node_provenance": json.loads((root / "contracts/context/files-cli-v1/expected.json").read_text())["provenance"],
    }
    records, streams, signals, differences, groups = [], [], [], [], []
    pending_children = {}

    def finish(*processes):
        nonlocal cleaning
        failures = []
        cleaning = True
        try:
            for process in processes:
                if process is None:
                    continue
                try:
                    groups.append(settle(process))
                    pending_children.pop(process.pid)
                except Exception as error:
                    failures.append(error)
        finally:
            cleaning = False
        if failures:
            raise failures[0]
        if interrupted:
            raise KeyboardInterrupt

    @contextmanager
    def temporary_workspace():
        nonlocal cleaning
        temporary = None
        try:
            with registered_startup():
                temporary = tempfile.mkdtemp(prefix="context-native-", dir=args.scratch)
            yield temporary
        finally:
            cleaning = True
            try:
                if pending_children:
                    raise RuntimeError(f"unsettled owned groups {sorted(pending_children)}; preserved {temporary}")
                if temporary is not None:
                    shutil.rmtree(temporary)
            finally:
                cleaning = False
            if interrupted:
                raise KeyboardInterrupt
    scripts = {"context": root / "lib/context-pack.mjs", "skills": root / "lib/skill-catalog.mjs", "ontology": root / "modules/ontology/cli.mjs"}

    def commands(command, argv):
        return [args.node, str(scripts[command]), *argv], [str(binary), command, *argv]

    def pair(label, command, argv, cwd, exact=True, env=None):
        node_command, go_command = commands(command, argv)
        node, go = completed(node_command, cwd, env), completed(go_command, cwd, env)
        same = node == go
        record = {"id": label, "args_hex": [os.fsencode(a).hex() for a in argv], "node": node, "go": go, "equal": same}
        records.append(record)
        if exact and not same:
            differences.append(label)
        if not exact:
            assert node["status"] == go["status"] != 0, record
        return node, go

    with temporary_workspace() as temporary:
        scratch = Path(temporary)
        for entry in corpus["cli"]:
            cwd = scratch / entry["id"]
            cwd.mkdir()
            for file in entry["files"]:
                path = cwd / file["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(bytes.fromhex(file["hex"]))
            pair(entry["id"], entry["command"], entry["args"], cwd)
        cwd = scratch / "raw-argv"
        cwd.mkdir()
        replacement = cwd / "�"
        (replacement / ".harness").mkdir(parents=True)
        (replacement / ".harness/decisions.md").write_text("- replacement root 😀\n")
        (cwd / "�.json").write_text('{"schema_version":1,"terms":[],"relations":[]}')
        malformed = [bytes.fromhex(h) for h in ["e282", "8081", "c0af", "eda080", "f4908080", "e241", "efbbbf"]]
        for raw in malformed:
            pair("raw-context-option-" + raw.hex(), "context", [b"--" + raw], cwd)
            pair("raw-skills-usage-" + raw.hex(), "skills", [raw], cwd)
            pair("raw-ontology-option-" + raw.hex(), "ontology", ["inspect", b"--" + raw], cwd)
        pair("raw-context-root-truncated", "context", ["--root", b"\xe2\x82"], cwd)
        pair("raw-skills-root-truncated", "skills", ["--root", b"\xe2\x82"], cwd)
        pair("raw-ontology-file-truncated", "ontology", ["inspect", "--file", b"\xe2\x82.json"], cwd)
        (cwd / "root-link").symlink_to(replacement, target_is_directory=True)
        pair("context-root-symlink", "context", ["--root", "root-link"], cwd)
        pair("context-explicit-dot", "context", ["--root", "."], replacement)
        pair("context-default-cwd", "context", [], replacement)
        pair("skills-explicit-dot", "skills", ["--root", "."], replacement)
        pair("skills-default-cwd", "skills", [], replacement)
        physical = scratch / "pwd-physical/child"
        physical.mkdir(parents=True)
        logical = scratch / "pwd-logical/alias"
        logical.parent.mkdir()
        logical.symlink_to(physical, target_is_directory=True)
        (physical.parent / "ontology.json").write_text('{"schema_version":1,"terms":[],"relations":[]}')
        (logical.parent / "ontology.json").write_text("{")
        (physical / "skills/alpha").mkdir(parents=True)
        (physical / "skills/alpha/SKILL.md").write_text("---\nname: alpha\ndescription: local\n---\nbody\n")
        logical_env = {**os.environ, "PWD": str(logical)}
        pair("logical-pwd-ontology-parent", "ontology", ["inspect", "--file", "../ontology.json"], physical, env=logical_env)
        pair("logical-pwd-skills-dot-root", "skills", ["--root", "."], physical, env=logical_env)
        # Native errno messages belong to the OS/runtime, outside portable byte parity.
        os_error = scratch / "os-error"
        (os_error / ".harness/decisions.md").mkdir(parents=True)
        pair("metadata-directory-errno", "context", [], os_error, exact=False)
        if sys.platform.startswith("linux"):
            raw_cwd = os.fsencode(scratch) + b"/cwd-\xe2\x82"
            decoded_cwd = scratch / "cwd-�"
            os.mkdir(raw_cwd)
            (decoded_cwd / ".harness").mkdir(parents=True)
            (decoded_cwd / ".harness/decisions.md").write_text("- decoded native cwd\n")
            pair("native-cwd-default", "context", [], raw_cwd)
            pair("native-cwd-explicit-dot", "context", ["--root", "."], raw_cwd)
            (decoded_cwd / "skills/alpha").mkdir(parents=True)
            (decoded_cwd / "skills/alpha/SKILL.md").write_text("---\nname: alpha\ndescription: local\n---\nbody\n")
            (Path(os.fsdecode(raw_cwd)) / "skills/alpha").mkdir(parents=True)
            (Path(os.fsdecode(raw_cwd)) / "skills/alpha/SKILL.md").write_text("---\nname: alpha\ndescription: raw source\n---\nbody\n")
            pair("native-cwd-skills-default", "skills", [], raw_cwd)
            pair("native-cwd-skills-dot", "skills", ["--root", "."], raw_cwd)
            raw_link = scratch / "raw-root-link"
            os.symlink(raw_cwd, os.fsencode(raw_link))
            pair("native-canonical-root-symlink", "skills", ["--root", str(raw_link)], scratch)
        for runtime in ["node", "go"]:
            cwd = scratch / ("fifo-" + runtime)
            (cwd / ".harness").mkdir(parents=True)
            fifo = cwd / ".harness/decisions.md"
            os.mkfifo(fifo)
            command = commands("context", [])[0 if runtime == "node" else 1]
            child = writer = None
            try:
                with registered_startup():
                    child = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                    pending_children[child.pid] = child
                with registered_startup():
                    writer = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "--fifo-writer", str(fifo)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                    pending_children[writer.pid] = writer
                out, err = child.communicate(timeout=10)
                writer_out, writer_err = writer.communicate(timeout=10)
                assert child.returncode == writer.returncode == 0, (child.returncode, writer.returncode, err, writer_err)
                assert not writer_out and not writer_err
                streams.append({"runtime": runtime, "bytes_written": 1024 * 1024 + 3, "status": child.returncode, "stdout_hex": out.hex(), "stderr_hex": err.hex(), "writer_waited": True, "child_waited": True})
            finally:
                finish(child, writer)
            for sig in [signal.SIGINT, signal.SIGTERM, signal.SIGKILL]:
                child = None
                blocked, forced = False, sig == signal.SIGKILL
                try:
                    with registered_startup():
                        child = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                        pending_children[child.pid] = child
                    try:
                        child.communicate(timeout=0.3)
                    except subprocess.TimeoutExpired:
                        blocked = True
                    assert blocked, "metadata FIFO unexpectedly completed without a writer"
                    os.killpg(child.pid, sig)
                    try:
                        out, err = child.communicate(timeout=1)
                    except subprocess.TimeoutExpired:
                        forced = True
                        os.killpg(child.pid, signal.SIGKILL)
                        out, err = child.communicate(timeout=5)
                    signals.append({"runtime": runtime, "signal": sig.name, "blocked_observed": blocked, "forced_kill": forced, "raw_returncode": child.returncode, "shell_status": child.returncode if child.returncode >= 0 else 128 - child.returncode, "waited": True, "stdout_hex": out.hex(), "stderr_hex": err.hex()})
                finally:
                    finish(child)
        assert streams[0]["stdout_hex"] == streams[1]["stdout_hex"], "FIFO metadata byte behavior differs"
        temporary_path = temporary
    assert not Path(temporary_path).exists(), "owned temporary directory survived cleanup"
    report = {"source": source, "profile": {**profile, "python": platform.python_version(), "os": sys.platform, "machine": platform.machine()}, "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "cases": records, "fifo": streams, "signals": signals, "process_groups": groups, "known_nonportable_errno": ["metadata-directory-errno"], "differences": differences, "temporary_removed": True}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n")
    print(json.dumps({"pairs": len(records), "differences": differences, "fifo": len(streams), "signals_waited": len(signals), "temporary_removed": True}))
    return 1 if differences else 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--fifo-writer":
        with open(sys.argv[2], "wb") as stream:
            stream.write(b"x" * (1024 * 1024) + bytes.fromhex("e28200"))
    else:
        raise SystemExit(main())
