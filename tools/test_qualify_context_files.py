"""Real child-process regressions for Context qualification ownership."""

import json
import errno
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

import qualify_context_files as qualifier


owned_supervisors = []
owned_fixtures = []


def new_owner():
    owner = qualifier.ProcessOwner()
    owned_supervisors.append(owner)
    return owner


def cleanup_driver(supervisor, driver, root, timeout=10):
    """Always settle the supervisor and its authoritative separate-session ledger."""
    previous = supervisor.cleaning
    supervisor.cleaning = True
    try:
        errors = []
        ledger_settled = False
        try:
            (root / "release").touch()
            if driver.poll() is None:
                os.killpg(driver.pid, signal.SIGTERM)
                driver.communicate(timeout=timeout)
        except Exception as error:
            errors.append(error)
        finally:
            try:
                supervisor.finish(driver)  # Kills/waits a driver that ignored TERM or timed out.
            except Exception as error:
                errors.append(error)
            finally:
                try:
                    ledger = json.loads((root / "created.json").read_text())
                    assert ledger["uid"] == os.getuid()
                    for pgid in ledger["pgids"]:
                        end, killed = time.monotonic() + 5, False
                        while True:
                            try:
                                os.killpg(pgid, 0)
                            except ProcessLookupError:
                                break
                            except PermissionError:
                                pass  # Unknown; bounded reobserve, never absence.
                            else:
                                if not killed:
                                    assert os.getpgid(pgid) == pgid
                                    os.killpg(pgid, signal.SIGKILL)
                                    killed = True
                            if time.monotonic() >= end:
                                raise AssertionError(f"unobservable owned group {pgid}; fixture preserved at {root}")
                            time.sleep(0.02)
                    ledger_settled = True
                except Exception as error:
                    errors.append(error)
                finally:
                    if ledger_settled and not supervisor.pending:
                        shutil.rmtree(root)
        if errors:
            raise errors[0]
    finally:
        supervisor.cleaning = previous


def cleanup_report(run_id):
    return {"run_id": run_id, "cleanup_complete": all(not o.pending for o in owned_supervisors) and all(not p.exists() for p in owned_fixtures),
            "unsettled_groups": [pid for o in owned_supervisors for pid in o.pending],
            "process_groups": [g for o in owned_supervisors for g in o.groups],
            "preserved_fixtures": [str(p) for p in owned_fixtures if p.exists()]}


def check_cleanup(report, run_id):
    assert report["run_id"] == run_id and report["cleanup_complete"] is True
    assert not report["unsettled_groups"] and not report["preserved_fixtures"]
    assert all(g["waited"] and g["state"] == "observed absent" for g in report["process_groups"])


def child_driver(mode, directory):
    root = Path(directory)
    fifo = root / "record"
    os.mkfifo(fifo)
    owner = new_owner()
    original = subprocess.Popen
    created = []
    target = 2 if mode == "writer" else 1

    def hold_startup(*args, **kwargs):
        process = original(*args, **kwargs)
        created.append(process.pid)
        (root / "created.json").write_text(json.dumps({"uid": os.getuid(), "pgids": created}))
        if len(created) == target:
            os.kill(process.pid, signal.SIGSTOP)
            (root / "ready.json").write_text(json.dumps({"pid": process.pid, "pgid": os.getpgid(process.pid), "uid": os.getuid(), "created": created}))
            while not (root / "release").exists():
                time.sleep(0.01)
        return process

    interrupted = False
    try:
        with patch.object(subprocess, "Popen", hold_startup), owner:
            if mode == "pair":
                owner.capture([sys.executable, "-B", "-c", "import time;time.sleep(20)"], label="paired-child")
            else:
                reader = owner.spawn([sys.executable, "-B", "-c", "import sys;open(sys.argv[1],'rb').read()", str(fifo)], label="fifo-reader")
                writer = owner.spawn([sys.executable, "-B", str(Path(qualifier.__file__).resolve()), "--fifo-writer", str(fifo)], label="fifo-writer")
                reader.communicate(timeout=5)
                writer.communicate(timeout=5)
    except KeyboardInterrupt:
        interrupted = True
    finally:
        (root / "result.json").write_text(json.dumps({"interrupted": interrupted, "pending": sorted(owner.pending), "groups": owner.groups, "signals": owner.signals, "created": created}))


class OwnershipTests(unittest.TestCase):
    def test_original_signal_mask_is_preserved(self):
        original = signal.pthread_sigmask(signal.SIG_BLOCK, [])
        for masked in [False, True]:
            with self.subTest(masked=masked):
                try:
                    if masked:
                        signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
                    expected = sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK, []))
                    with new_owner() as owner:
                        result = owner.capture([sys.executable, "-B", "-c", "import signal,json;print(json.dumps(sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK,[]))))"], check=True)
                    self.assertEqual(json.loads(result.stdout), expected)
                    self.assertFalse(owner.pending)
                    self.assertTrue(all(g["waited"] and g["state"] == "observed absent" for g in owner.groups))
                    print(json.dumps({"case": "original-mask", "expected": expected, "actual": json.loads(result.stdout), "groups": owner.groups}), flush=True)
                finally:
                    signal.pthread_sigmask(signal.SIG_SETMASK, original)

    def test_popen_error_precedes_deferred_interrupt(self):
        owner = new_owner()
        original = subprocess.Popen
        with tempfile.TemporaryDirectory(prefix="context-popen-error-") as temporary:
            missing = str(Path(temporary) / "not-created")

            def fail(*_args, **_kwargs):
                os.kill(os.getpid(), signal.SIGTERM)
                return original([missing], **_kwargs)

            with self.assertRaises(FileNotFoundError) as caught:
                with owner, patch.object(subprocess, "Popen", fail):
                    owner.capture([missing])
        self.assertEqual(caught.exception.errno, errno.ENOENT)
        self.assertTrue(owner.interrupted)
        self.assertFalse(owner.pending)

    def test_interruption_between_children_prevents_next_spawn(self):
        owner = new_owner()
        original = qualifier.settle
        started = []

        def interrupt_cleanup(process):
            started.append(process.pid)
            os.kill(os.getpid(), signal.SIGTERM)
            return original(process)

        with self.assertRaises(KeyboardInterrupt):
            with owner, patch.object(qualifier, "settle", interrupt_cleanup):
                owner.capture([sys.executable, "-B", "-c", "pass"])
                self.fail("a second child must not start")
        self.assertEqual(len(started), 1)
        self.assertFalse(owner.pending)

    def test_repeated_cleanup_signals_do_not_interrupt_wait(self):
        owner = new_owner()
        original = qualifier.settle

        def interrupt_cleanup(process):
            for _ in range(2):
                os.kill(os.getpid(), signal.SIGTERM)
            return original(process)

        with self.assertRaises(KeyboardInterrupt):
            with patch.object(qualifier, "settle", interrupt_cleanup), owner:
                owner.spawn([sys.executable, "-B", "-c", "import time;time.sleep(20)"])
        self.assertEqual(owner.signals, [signal.SIGTERM, signal.SIGTERM])
        self.assertFalse(owner.pending)
        self.assertTrue(all(g["waited"] and g["state"] == "observed absent" for g in owner.groups))

    def test_driver_timeout_still_waits_and_cleans_ledger(self):
        root = Path(tempfile.mkdtemp(prefix="context-driver-timeout-"))
        owned_fixtures.append(root)
        (root / "created.json").write_text(json.dumps({"uid": os.getuid(), "pgids": []}))
        with new_owner() as supervisor:
            driver = supervisor.spawn([sys.executable, "-B", "-c", "import signal,sys,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print('ready',flush=True);time.sleep(30)"], label="TERM-ignoring-driver")
            try:
                self.assertEqual(driver.stdout.readline(), b"ready\n")
            finally:
                with self.assertRaises(subprocess.TimeoutExpired):
                    cleanup_driver(supervisor, driver, root, timeout=0.05)
        self.assertFalse(supervisor.pending)
        self.assertFalse(root.exists())
        self.assertTrue(all(g["waited"] and g["state"] == "observed absent" for g in supervisor.groups))
        print(json.dumps({"case": "driver-timeout-cleanup", "groups": supervisor.groups, "fixture_removed": not root.exists()}), flush=True)

    def test_unobservable_ledger_preserves_fixture(self):
        root = Path(tempfile.mkdtemp(prefix="context-ledger-unknown-"))
        owned_fixtures.append(root)
        real_killpg = os.killpg
        with new_owner() as nested, new_owner() as supervisor:
            child = nested.spawn([sys.executable, "-B", "-c", "import time;time.sleep(30)"], label="authoritative-ledger-child")
            driver = supervisor.spawn([sys.executable, "-B", "-c", "pass"], label="ledger-driver")
            (root / "created.json").write_text(json.dumps({"uid": os.getuid(), "pgids": [child.pid]}))
            def unknown(pgid, sig):
                if pgid == child.pid and sig == 0:
                    raise PermissionError(errno.EPERM, "controlled unknown group observation")
                return real_killpg(pgid, sig)
            try:
                with patch.object(os, "killpg", unknown), self.assertRaises(AssertionError):
                    cleanup_driver(supervisor, driver, root)
                self.assertTrue(root.exists())
                self.assertIsNone(child.poll())
                print(json.dumps({"case": "unobservable-ledger", "known_pgid": child.pid, "fixture_preserved": root.exists(), "observation": "controlled EPERM; never absence"}), flush=True)
            finally:
                nested.finish(child)
                if not nested.pending and not supervisor.pending:
                    shutil.rmtree(root)
        self.assertFalse(root.exists())

    def test_native_cleanup_receipt_requires_current_complete_run(self):
        with tempfile.TemporaryDirectory(prefix="context-receipt-test-") as temporary:
            base = Path(temporary).resolve()
            expected = {"run_id": "a" * 32, "source": {"head": "head", "tree": "tree", "working_diff_sha256": "diff", "go_source_sha256": {}}, "binary_sha256": "binary", "scratch_base": str(base)}
            receipt = {"run_id": expected["run_id"], "source": expected["source"], "binary_sha256": "binary", "cleanup_complete": True, "temporary_removed": True, "unsettled_groups": [], "process_groups": [{"waited": True, "state": "observed absent"}], "scratch_identity": {"base": str(base), "run_id": expected["run_id"], "workspace": str(base / ("context-native-" + expected["run_id"] + "-gone")), "device": 1, "inode": 2}, "behavior_exit_code": 1}
            self.assertTrue(qualifier.cleanup_receipt_matches(receipt, expected))
            for key, value in [("cleanup_complete", False), ("run_id", "b" * 32), ("binary_sha256", "other"), ("source", {**expected["source"], "tree": "other"})]:
                with self.subTest(key=key), self.assertRaises(AssertionError):
                    qualifier.cleanup_receipt_matches({**receipt, key: value}, expected)
            with self.assertRaises(KeyError):
                qualifier.cleanup_receipt_matches({}, expected)

    def test_startup_handshakes_cover_pair_fifo_and_writer(self):
        for mode in ["pair", "reader", "writer"]:
            with self.subTest(mode=mode):
                root = Path(tempfile.mkdtemp(prefix="context-owner-test-"))
                owned_fixtures.append(root)
                with new_owner() as supervisor:
                    driver = supervisor.spawn([sys.executable, "-B", str(Path(__file__).resolve()), "--driver", mode, str(root)], label="startup-driver")
                    try:
                        end = time.monotonic() + 8
                        while not (root / "ready.json").exists() and time.monotonic() < end:
                            self.assertIsNone(driver.poll(), "driver exited before Popen handshake")
                            time.sleep(0.01)
                        self.assertTrue((root / "ready.json").exists(), "startup handshake missing")
                        ready = json.loads((root / "ready.json").read_text())
                        self.assertEqual(ready["uid"], os.getuid())
                        self.assertEqual(ready["pid"], ready["pgid"])
                        self.assertEqual(os.getpgid(ready["pid"]), ready["pgid"])
                        os.killpg(driver.pid, signal.SIGTERM)
                        (root / "release").touch()
                        out, err = driver.communicate(timeout=10)
                        self.assertEqual(driver.returncode, 0, (out, err))
                        supervisor.finish(driver)
                        result = json.loads((root / "result.json").read_text())
                        self.assertTrue(result["interrupted"])
                        self.assertFalse(result["pending"])
                        self.assertEqual(sorted(g["pgid"] for g in result["groups"]), sorted(result["created"]))
                        self.assertTrue(all(g["waited"] and g["state"] == "observed absent" for g in result["groups"]))
                    finally:
                        cleanup_driver(supervisor, driver, root)
                print(json.dumps({"case": "startup-" + mode, "groups": result["groups"], "supervisor_groups": supervisor.groups, "fixture_removed": not root.exists()}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--driver":
        child_driver(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == "--check-cleanup":
        check_cleanup(json.loads(Path(sys.argv[2]).read_text()), sys.argv[3])
    else:
        report = None
        run_id = uuid.uuid4().hex
        if "--cleanup-report" in sys.argv:
            index = sys.argv.index("--cleanup-report")
            report, run_id = Path(sys.argv[index + 1]), sys.argv[index + 2]
            assert not report.exists(), "regression cleanup report must be fresh"
            del sys.argv[index:index + 3]
        try:
            result = unittest.main(exit=False).result
        finally:
            if report:
                report.write_text(json.dumps(cleanup_report(run_id), indent=2) + "\n")
        raise SystemExit(0 if result.wasSuccessful() else 1)
