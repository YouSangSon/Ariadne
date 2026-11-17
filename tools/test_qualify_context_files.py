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
from unittest.mock import patch

import qualify_context_files as qualifier


def child_driver(mode, directory):
    root = Path(directory)
    fifo = root / "record"
    os.mkfifo(fifo)
    owner = qualifier.ProcessOwner()
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
                    with qualifier.ProcessOwner() as owner:
                        result = owner.capture([sys.executable, "-B", "-c", "import signal,json;print(json.dumps(sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK,[]))))"], check=True)
                    self.assertEqual(json.loads(result.stdout), expected)
                    self.assertFalse(owner.pending)
                    self.assertTrue(all(g["waited"] and g["state"] == "observed absent" for g in owner.groups))
                    print(json.dumps({"case": "original-mask", "expected": expected, "actual": json.loads(result.stdout), "groups": owner.groups}), flush=True)
                finally:
                    signal.pthread_sigmask(signal.SIG_SETMASK, original)

    def test_popen_error_precedes_deferred_interrupt(self):
        owner = qualifier.ProcessOwner()
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
        owner = qualifier.ProcessOwner()
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
        owner = qualifier.ProcessOwner()
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

    def test_startup_handshakes_cover_pair_fifo_and_writer(self):
        for mode in ["pair", "reader", "writer"]:
            with self.subTest(mode=mode):
                root = Path(tempfile.mkdtemp(prefix="context-owner-test-"))
                with qualifier.ProcessOwner() as supervisor:
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
                        (root / "release").touch()
                        if driver.poll() is None:
                            os.killpg(driver.pid, signal.SIGTERM)
                            driver.communicate(timeout=10)
                        supervisor.finish(driver)
                        # Authoritative startup ledger only: never discover a process by name.
                        if (root / "created.json").exists():
                            ledger = json.loads((root / "created.json").read_text())
                            self.assertEqual(ledger["uid"], os.getuid())
                            for pgid in ledger["pgids"]:
                                end = time.monotonic() + 5
                                killed = False
                                while True:
                                    try:
                                        os.killpg(pgid, 0)
                                    except ProcessLookupError:
                                        break
                                    except PermissionError:
                                        pass
                                    else:
                                        if not killed:
                                            self.assertEqual(os.getpgid(pgid), pgid)
                                            os.killpg(pgid, signal.SIGKILL)
                                            killed = True
                                    if time.monotonic() >= end:
                                        self.fail(f"unobservable owned group {pgid}; fixture preserved at {root}")
                                    time.sleep(0.02)
                        shutil.rmtree(root)
                print(json.dumps({"case": "startup-" + mode, "groups": result["groups"], "supervisor_groups": supervisor.groups, "fixture_removed": not root.exists()}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--driver":
        child_driver(sys.argv[2], sys.argv[3])
    else:
        unittest.main()
