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
import uuid


class ProcessOwner:
    """Own this qualifier's children without changing their inherited signal mask."""

    def __init__(self):
        self.starting = self.cleaning = self.interrupted = False
        self.pending = {}
        self.groups = []
        self.signals = []

    def __enter__(self):
        self.previous_handlers = {s: signal.getsignal(s) for s in [signal.SIGINT, signal.SIGTERM]}
        for sig in self.previous_handlers:
            signal.signal(sig, self.interrupt)
        return self

    def interrupt(self, signum, _frame):
        self.signals.append(signum)
        self.interrupted = True
        if not self.starting and not self.cleaning:
            raise KeyboardInterrupt

    def checkpoint(self):
        if self.interrupted and not self.cleaning:
            raise KeyboardInterrupt

    @contextmanager
    def startup(self):
        self.checkpoint()
        self.starting = True
        completed = False
        try:
            yield
            completed = True
        finally:
            # On a Popen failure, defer signals through scope exit: preserve that error.
            if completed:
                self.starting = False
        if completed:
            self.checkpoint()

    def spawn(self, command, *, cwd=None, env=None, label="child"):
        with self.startup():
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            self.pending[process.pid] = (process, label)
        return process

    def finish(self, *processes):
        previous = self.cleaning
        self.cleaning = True
        failures = []
        try:
            for process in processes:
                if process is None or process.pid not in self.pending:
                    continue
                try:
                    record = settle(process)
                    record["phase"] = self.pending[process.pid][1]
                    self.groups.append(record)
                    del self.pending[process.pid]
                except Exception as error:
                    failures.append(error)
        finally:
            self.cleaning = previous
        if failures:
            raise failures[0]

    def capture(self, command, *, cwd=None, env=None, label="capture", check=False):
        process = self.spawn(command, cwd=cwd, env=env, label=label)
        try:
            out, err = process.communicate(timeout=20)
            result = subprocess.CompletedProcess(command, process.returncode, out, err)
        finally:
            self.finish(process)
        self.checkpoint()
        if check:
            result.check_returncode()
        return result

    def close(self):
        self.cleaning = True
        self.starting = False
        self.finish(*(p for p, _label in list(self.pending.values())))

    def restore_handlers(self):
        for sig, handler in self.previous_handlers.items():
            signal.signal(sig, handler)

    def __exit__(self, kind, value, traceback):
        try:
            self.close()
        finally:
            self.restore_handlers()
        if kind is None and self.interrupted:
            raise KeyboardInterrupt
        return False


def settle(process):
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.communicate(timeout=5)
    record = {"pgid": process.pid, "waited": True, "returncode": process.returncode, "observation_errors": []}
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


def source_identity(owner, root):
    def output(command):
        return owner.capture(command, cwd=root, check=True, label="source-identity").stdout
    return {
        "head": output(["git", "rev-parse", "HEAD"]).decode().strip(),
        "tree": output(["git", "rev-parse", "HEAD^{tree}"]).decode().strip(),
        "working_diff_sha256": hashlib.sha256(output(["git", "diff", "HEAD", "--binary"])).hexdigest(),
        "go_source_sha256": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root / "runtime/go").rglob("*.go"))},
        "node_provenance": json.loads((root / "contracts/context/files-cli-v1/expected.json").read_text())["provenance"],
    }


def cleanup_receipt_matches(receipt, expected):
    """Require this run's source/binary identity and observed nested cleanup."""
    for key in ["head", "tree", "working_diff_sha256", "go_source_sha256"]:
        assert receipt["source"][key] == expected["source"][key], key
    assert receipt["binary_sha256"] == expected["binary_sha256"]
    assert receipt["run_id"] == expected["run_id"] and len(receipt["run_id"]) == 32
    assert receipt["cleanup_complete"] is True and receipt["temporary_removed"] is True
    assert not receipt["unsettled_groups"]
    assert receipt["process_groups"] and all(g["waited"] and g["state"] == "observed absent" for g in receipt["process_groups"])
    identity = receipt["scratch_identity"]
    base = Path(expected["scratch_base"])
    assert identity["base"] == str(base) and identity["run_id"] == receipt["run_id"]
    workspace = Path(identity["workspace"])
    assert workspace.parent == base and workspace.name.startswith("context-native-" + receipt["run_id"] + "-")
    assert not workspace.exists()
    assert isinstance(identity["device"], int) and isinstance(identity["inode"], int)
    return True


def prepare_run(binary, scratch, report, marker):
    assert not marker.exists() and not report.exists(), "run marker/report must be fresh"
    root = Path(__file__).resolve().parents[1]
    with ProcessOwner() as owner:
        source = source_identity(owner, root)
    expected = {"run_id": uuid.uuid4().hex, "source": source,
                "binary_sha256": hashlib.sha256(binary.resolve(strict=True).read_bytes()).hexdigest(),
                "scratch_base": str(scratch.resolve()), "report": str(report.resolve())}
    marker.write_text(json.dumps(expected, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go-cli", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--run-marker", type=Path)
    args = parser.parse_args()
    assert sys.platform == "darwin" or sys.platform.startswith("linux"), sys.platform
    if args.report.exists():
        parser.error("report must be a fresh path")
    root = Path(__file__).resolve().parents[1]
    binary = args.go_cli.resolve(strict=True)
    args.scratch.mkdir(parents=True, exist_ok=True)
    expected = json.loads(args.run_marker.read_text()) if args.run_marker else None
    run_id = expected["run_id"] if expected else uuid.uuid4().hex
    assert len(run_id) == 32 and all(c in "0123456789abcdef" for c in run_id)
    owner = ProcessOwner()
    records, streams, signals, differences = [], [], [], []
    profile, source, workspace = {}, None, None
    scratch_identity = {"base": str(args.scratch.resolve()), "run_id": run_id}
    binary_sha256 = hashlib.sha256(binary.read_bytes()).hexdigest()
    behavior_error = None
    code = 1
    scripts = {"context": root / "lib/context-pack.mjs", "skills": root / "lib/skill-catalog.mjs", "ontology": root / "modules/ontology/cli.mjs"}

    def output(command, label):
        return owner.capture(command, cwd=root, label=label, check=True).stdout

    def commands(command, argv):
        return [args.node, str(scripts[command]), *argv], [str(binary), command, *argv]

    def pair(label, command, argv, cwd, exact=True, env=None):
        values = []
        for runtime, cmd in zip(["node", "go"], commands(command, argv)):
            result = owner.capture(cmd, cwd=cwd, env=env, label=label + ":" + runtime)
            values.append({"status": result.returncode, "stdout_hex": result.stdout.hex(), "stderr_hex": result.stderr.hex()})
        node, go = values
        same = node == go
        records.append({"id": label, "args_hex": [os.fsencode(a).hex() for a in argv], "node": node, "go": go, "equal": same})
        if exact and not same:
            differences.append(label)
        if not exact:
            assert node["status"] == go["status"] != 0, records[-1]
        return node, go

    owner.__enter__()
    try:
        profile = json.loads(output([args.node, "-p", "JSON.stringify({node:process.version,icu:process.versions.icu,unicode:process.versions.unicode})"], "node-profile"))
        assert profile == {"node": "v24.22.2", "icu": "78.3", "unicode": "17.0"}, profile
        assert platform.python_version() == "3.14.5", platform.python_version()
        corpus = json.loads((root / "contracts/context/files-cli-v1/cases.json").read_text())
        source = source_identity(owner, root)
        if expected:
            assert expected["source"] == source
            assert expected["binary_sha256"] == binary_sha256
            assert expected["scratch_base"] == str(args.scratch.resolve())
            assert expected["report"] == str(args.report.resolve())
        with owner.startup():
            workspace = Path(tempfile.mkdtemp(prefix="context-native-" + run_id + "-", dir=args.scratch))
            stat = workspace.stat()
            scratch_identity.update(workspace=str(workspace.resolve()), device=stat.st_dev, inode=stat.st_ino)
            (workspace / ".native-proof-run").write_text(run_id)
        scratch = workspace
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
                child = owner.spawn(command, cwd=cwd, label="fifo-" + runtime + "-reader")
                writer = owner.spawn([sys.executable, "-B", str(Path(__file__).resolve()), "--fifo-writer", str(fifo)], label="fifo-" + runtime + "-writer")
                out, err = child.communicate(timeout=10)
                writer_out, writer_err = writer.communicate(timeout=10)
                assert child.returncode == writer.returncode == 0, (child.returncode, writer.returncode, err, writer_err)
                assert not writer_out and not writer_err
                streams.append({"runtime": runtime, "bytes_written": 1024 * 1024 + 3, "status": child.returncode, "stdout_hex": out.hex(), "stderr_hex": err.hex(), "writer_waited": True, "child_waited": True})
            finally:
                owner.finish(child, writer)
            for sig in [signal.SIGINT, signal.SIGTERM, signal.SIGKILL]:
                child = None
                blocked, forced = False, sig == signal.SIGKILL
                try:
                    child = owner.spawn(command, cwd=cwd, label="signal-" + runtime + "-" + sig.name)
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
                    owner.finish(child)
        assert streams[0]["stdout_hex"] == streams[1]["stdout_hex"], "FIFO metadata byte behavior differs"
        code = 1 if differences else 0
    except KeyboardInterrupt:
        behavior_error = "interrupted"
        code = 130
    except Exception as error:
        behavior_error = f"{type(error).__name__}: {error}"
    finally:
        try:
            owner.close()
        except Exception as error:
            behavior_error = behavior_error or f"{type(error).__name__}: {error}"
            code = 1
        temporary_removed = workspace is None
        cleanup_error = None
        if not owner.pending:
            if workspace is not None:
                try:
                    stat = workspace.stat()
                    assert stat.st_dev == scratch_identity["device"] and stat.st_ino == scratch_identity["inode"]
                    assert (workspace / ".native-proof-run").read_text() == run_id
                    shutil.rmtree(workspace)
                    temporary_removed = not workspace.exists()
                except Exception as error:
                    cleanup_error = f"{type(error).__name__}: {error}"
        else:
            cleanup_error = "unsettled owned groups; workspace preserved"
        cleanup_complete = not owner.pending and temporary_removed and cleanup_error is None
        if owner.interrupted and behavior_error is None:
            behavior_error = "interrupted"
            code = 130
        report = {"run_id": run_id, "scratch_identity": scratch_identity, "source": source, "profile": {**profile, "python": platform.python_version(), "os": sys.platform, "machine": platform.machine()}, "binary_sha256": binary_sha256, "behavior_exit_code": code, "behavior_error": behavior_error, "cases": records, "fifo": streams, "signals": signals, "driver_signals": owner.signals, "process_groups": owner.groups, "unsettled_groups": sorted(owner.pending), "cleanup_complete": cleanup_complete, "cleanup_error": cleanup_error, "known_nonportable_errno": ["metadata-directory-errno"], "differences": differences, "temporary_removed": temporary_removed}
        try:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            temporary_report = args.report.with_name(args.report.name + ".tmp-" + run_id)
            with temporary_report.open("x") as stream:
                stream.write(json.dumps(report, ensure_ascii=True, indent=2) + "\n")
            temporary_report.replace(args.report)
        finally:
            owner.restore_handlers()
        owner.cleaning = False
        if behavior_error is None:
            owner.checkpoint()
    print(json.dumps({"run_id": run_id, "pairs": len(records), "differences": differences, "fifo": len(streams), "signals_waited": len(signals), "behavior_exit_code": code, "cleanup_complete": cleanup_complete, "temporary_removed": temporary_removed}))
    return code if cleanup_complete else 1


if __name__ == "__main__":
    if len(sys.argv) == 6 and sys.argv[1] == "--prepare-run":
        prepare_run(*(Path(p) for p in sys.argv[2:]))
    elif len(sys.argv) == 4 and sys.argv[1] == "--check-cleanup":
        marker, report = (Path(p) for p in sys.argv[2:])
        expected = json.loads(marker.read_text())
        assert expected["report"] == str(report.resolve())
        cleanup_receipt_matches(json.loads(report.read_text()), expected)
    elif len(sys.argv) == 3 and sys.argv[1] == "--fifo-writer":
        with open(sys.argv[2], "wb") as stream:
            stream.write(b"x" * (1024 * 1024) + bytes.fromhex("e28200"))
    else:
        raise SystemExit(main())
