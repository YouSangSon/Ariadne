import copy
import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from qualify_extension_runtime import Laboratory, verify_profile, verify_os_profile, verify_limit_probe


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.image = "a" * 64
        self.item = {
            "Image": self.image,
            "Config": {"User": "65532:65532"},
            "HostConfig": {"Memory": 268435456, "MemorySwap": 268435456,
                "CpuPeriod": 100000, "CpuQuota": 100000, "PidsLimit": 32,
                "NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
                "Binds": [], "CapAdd": [], "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"],
                "LogConfig": {"Type": "none"}, "AutoRemove": False,
                "RestartPolicy": {"Name": "no"}},
        }

    def test_qualified_metadata_is_only_checked_not_granted(self):
        self.assertIsNone(verify_profile(self.item, self.image))

    def test_podman_expanded_drop_all_is_accepted(self):
        self.item["HostConfig"]["CapDrop"] = ["CAP_CHOWN", "CAP_DAC_OVERRIDE",
            "CAP_FOWNER", "CAP_FSETID", "CAP_KILL", "CAP_NET_BIND_SERVICE",
            "CAP_SETFCAP", "CAP_SETGID", "CAP_SETPCAP", "CAP_SETUID", "CAP_SYS_CHROOT"]
        self.assertIsNone(verify_profile(self.item, self.image))

    def test_partial_drops_and_added_capabilities_are_rejected(self):
        for change in ({"CapDrop": ["CAP_CHOWN"]}, {"CapAdd": ["CAP_SYS_ADMIN"]},
                       {"CapDrop": ["ALL", "CAP_CHOWN"]}):
            with self.subTest(change=change):
                item = copy.deepcopy(self.item)
                item["HostConfig"].update(change)
                with self.assertRaises(ValueError):
                    verify_profile(item, self.image)

    def test_resource_and_privacy_regressions_are_rejected(self):
        for field, value in [("NetworkMode", "host"), ("Privileged", True),
                ("ReadonlyRootfs", False), ("Memory", 0), ("CpuQuota", -1),
                ("Binds", ["/:/host"]), ("LogConfig", {"Type": "journald"}),
                ("SecurityOpt", []), ("RestartPolicy", {"Name": "always"})]:
            with self.subTest(field=field):
                item = copy.deepcopy(self.item)
                item["HostConfig"][field] = value
                with self.assertRaises(ValueError):
                    verify_profile(item, self.image)


class OperatingSystemTests(unittest.TestCase):
    def setUp(self):
        self.lines = ["268435456", "0", "100000 100000", "32",
            "CapInh:\t0000000000000000", "CapPrm:\t0000000000000000",
            "CapEff:\t0000000000000000", "CapBnd:\t0000000000000000",
            "CapAmb:\t0000000000000000", "NoNewPrivs:\t1", "Seccomp:\t2"]

    def test_zero_capabilities_and_enforced_security_are_accepted(self):
        self.assertIsNone(verify_os_profile(self.lines))

    def test_each_capability_and_security_control_is_required(self):
        for index in range(len(self.lines)):
            with self.subTest(field=self.lines[index]):
                changed = self.lines.copy()
                changed[index] = (changed[index].split(":")[0] + ": 1"
                                  if 4 <= index < 9 else "invalid")
                with self.assertRaises(ValueError):
                    verify_os_profile(changed)
                with self.assertRaises(ValueError):
                    verify_os_profile(self.lines[:index] + self.lines[index + 1:])


class LimitProbeTests(unittest.TestCase):
    def setUp(self):
        self.cpu = {"case": "cpu", "limits": {"memoryMax": 268435456,
            "memorySwapMax": 0, "cpuMax": "100000 100000", "pidsMax": 32},
            "before": {"nr_throttled": 2, "throttled_usec": 500},
            "after": {"nr_throttled": 5, "throttled_usec": 1500},
            "childrenStarted": 2, "childrenReaped": 2, "wallLimitMillis": 3000}
        self.pids = {"case": "pids", "limits": copy.deepcopy(self.cpu["limits"]),
            "before": {"max": 0}, "after": {"max": 1},
            "spawnAttempts": 32, "spawnFailures": 1, "failureErrno": 11,
            "childrenStarted": 31, "childrenReaped": 31}

    def test_cpu_requires_both_kernel_throttle_counters_to_grow(self):
        self.assertIsNone(verify_limit_probe("cpu", self.cpu))
        for counter in self.cpu["before"]:
            for value in (self.cpu["before"][counter], -1, True, "1000", 1 << 64):
                with self.subTest(counter=counter, value=value):
                    observation = copy.deepcopy(self.cpu)
                    observation["after"][counter] = value
                    with self.assertRaises(ValueError):
                        verify_limit_probe("cpu", observation)

    def test_pid_requires_kernel_rejection_and_finite_reaped_children(self):
        self.assertIsNone(verify_limit_probe("pids", self.pids))
        changes = [{"after": {"max": 0}}, {"spawnFailures": 0},
            {"failureErrno": 12}, {"spawnAttempts": 41}, {"spawnAttempts": 31},
            {"childrenStarted": 32}, {"childrenReaped": 30},
            {"after": {"max": -1}}, {"after": {"max": True}},
            {"after": {"max": 1 << 64}}]
        for change in changes:
            with self.subTest(change=change):
                observation = copy.deepcopy(self.pids)
                observation.update(change)
                with self.assertRaises(ValueError):
                    verify_limit_probe("pids", observation)

    def test_load_proof_requires_expected_limits_and_complete_observations(self):
        for kind, valid in (("cpu", self.cpu), ("pids", self.pids)):
            changes = [{"case": "other"}, {"before": {}}, {"after": {}},
                {"childrenReaped": 0}, {"limits": {**valid["limits"], "pidsMax": 64}},
                {"limits": {**valid["limits"], "cpuMax": "max 100000"}},
                {"limits": {**valid["limits"], "memorySwapMax": False}},
                {"before": {**valid["before"], "unknown": 1}}, {"unknown": 1}]
            for change in changes:
                with self.subTest(kind=kind, change=change):
                    observation = copy.deepcopy(valid)
                    observation.update(change)
                    with self.assertRaises(ValueError):
                        verify_limit_probe(kind, observation)
        with self.assertRaises(ValueError):
            verify_limit_probe("unknown", self.cpu)

    def test_probe_workload_accounting_rejects_invalid_numbers(self):
        for kind, valid, fields in (("cpu", self.cpu, ("childrenStarted", "childrenReaped", "wallLimitMillis")),
                ("pids", self.pids, ("childrenStarted", "childrenReaped", "spawnAttempts", "spawnFailures", "failureErrno"))):
            for field in fields:
                for value in (True, -1, 1 << 64):
                    with self.subTest(kind=kind, field=field, value=value):
                        observation = copy.deepcopy(valid)
                        observation[field] = value
                        with self.assertRaises(ValueError):
                            verify_limit_probe(kind, observation)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ariadne-q-unit-")
        self.addCleanup(self.directory.cleanup)
        self.lab = Laboratory(SimpleNamespace(podman="podman", connection="machine",
            image="a" * 64, evidence=self.directory.name))
        self.lab.server = {"uri": "ssh://core@127.0.0.1:50042/run/user/501/podman/podman.sock"}
        self.name = "ariadne-q-test"
        self.lab.owned.add(self.name)

    def test_eof_before_inspection_release_does_not_start_resource_load(self):
        class NotStarted(Exception):
            pass

        for kind in ("cpu", "pids"):
            with self.subTest(kind=kind):
                def start(_kind, shell):
                    harmless = shell.replace("/usr/local/bin/ariadne-qualification-os-probe", "/bin/echo")
                    result = subprocess.run(["/bin/sh", "-c", harmless], input=b"",
                                            capture_output=True, timeout=2)
                    self.assertEqual(result.stdout, b"", "resource load started after stdin EOF")
                    self.assertNotEqual(result.returncode, 0)
                    raise NotStarted()

                self.lab.start = start
                with self.assertRaises(NotStarted):
                    self.lab.resource_limit(kind)

    def test_endpoint_change_blocks_cleanup(self):
        self.lab.call = Mock(return_value=subprocess.CompletedProcess([], 0,
            json.dumps([{"Name": "machine", "URI": "ssh://other"}]).encode(), b""))
        with self.assertRaisesRegex(RuntimeError, "endpoint changed"):
            self.lab.dispose(self.name)
        self.assertEqual(len(self.lab.call.call_args_list), 1)
        self.assertIn(self.name, self.lab.owned)

    def test_replaced_container_id_blocks_cleanup(self):
        self.lab.container_ids = {self.name: "original-id"}
        item = {"Id": "replacement-id", "Config": {"Labels": {"io.ariadne.qualification": self.name}},
                "State": {"Running": True}}
        self.lab.call = Mock(side_effect=[subprocess.CompletedProcess([], 0,
            json.dumps([{"Name": "machine", "URI": self.lab.server["uri"]}]).encode(), b""),
            subprocess.CompletedProcess([], 0, json.dumps([item]).encode(), b"")])
        with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
            self.lab.dispose(self.name)
        self.assertEqual(len(self.lab.call.call_args_list), 2)
        self.assertIn(self.name, self.lab.owned)

    def test_resource_probe_preserves_counters_and_requires_proof_and_clean_exit(self):
        fixture = LimitProbeTests()
        fixture.setUp()
        flat = copy.deepcopy(fixture.cpu)
        flat["after"] = flat["before"].copy()
        for kind, observation, code, expected_error in (
                ("cpu", fixture.cpu, 0, None), ("pids", fixture.pids, 0, None),
                ("cpu", flat, 0, ValueError), ("cpu", fixture.cpu, 1, RuntimeError)):
            with self.subTest(kind=kind, code=code, expected_error=expected_error):
                process = subprocess.Popen([sys.executable, "-B", "-c",
                    "import sys; sys.stdin.buffer.readline(); sys.stdout.write(sys.argv[1]); sys.exit(int(sys.argv[2]))",
                    json.dumps(observation), str(code)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.lab.start = Mock(return_value=(self.name, process))
                self.lab.check_endpoint = Mock()
                self.lab.call = Mock(return_value=subprocess.CompletedProcess([], 1, b"", b"no such container"))
                count = len(self.lab.results)
                if expected_error:
                    with self.assertRaises(expected_error):
                        self.lab.resource_limit(kind)
                    self.assertEqual(len(self.lab.results), count)
                else:
                    self.lab.resource_limit(kind)
                    self.assertEqual(self.lab.results[-1]["observed"], observation)
                    self.assertEqual(self.lab.results[-1]["exitCode"], 0)
                self.assertIsNotNone(process.poll())
                self.assertTrue(all(stream.closed for stream in (process.stdin, process.stdout, process.stderr)))

    def test_failed_worker_reaps_process_and_pipe_readers(self):
        root = Path(self.directory.name)
        (root / "pure.wasm").write_bytes(b"fixture")
        (root / "input.json").write_text("{}")
        self.lab.args.fixtures = str(root)
        self.lab.args.input = str(root / "input.json")
        process = subprocess.Popen([sys.executable, "-B", "-c",
            "import sys,time; sys.stdout.buffer.write(b'\\x00\\x00\\x00\\x02{}'); sys.stdout.flush(); time.sleep(60)"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        self.lab.start = Mock(return_value=(self.name, process))
        self.lab.check_endpoint = Mock()
        self.lab.call = Mock(return_value=subprocess.CompletedProcess([], 1, b"", b"no such container"))
        previous_threads = set(threading.enumerate())
        with self.assertRaisesRegex(RuntimeError, "correlation mismatch"):
            self.lab.worker("pure", "ok")
        self.assertIsNotNone(process.poll())
        self.assertTrue(process.stdout.closed and process.stderr.closed)
        self.assertLessEqual(set(threading.enumerate()), previous_threads)

    def test_stalled_stdin_is_bounded_and_all_io_threads_are_reaped(self):
        root = Path(self.directory.name)
        (root / "pure.wasm").write_bytes(b"x" * 1048576)
        (root / "input.json").write_text("{}")
        self.lab.args.fixtures = str(root)
        self.lab.args.input = str(root / "input.json")
        process = subprocess.Popen([sys.executable, "-B", "-c", "import time; time.sleep(60)"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.lab.start = Mock(return_value=(self.name, process))
        self.lab.check_endpoint = Mock()
        self.lab.call = Mock(return_value=subprocess.CompletedProcess([], 1, b"", b"no such container"))
        previous_threads = set(threading.enumerate())
        outcomes = queue.Queue()
        original_get = queue.Queue.get

        def short_wait(target, *args, **kwargs):
            if "timeout" in kwargs:
                kwargs["timeout"] = min(kwargs["timeout"], 0.1)
            return original_get(target, *args, **kwargs)

        def invoke():
            try:
                self.lab.worker("pure", "ok")
            except BaseException as error:
                outcomes.put(error)

        caller = threading.Thread(target=invoke, daemon=True)
        try:
            with patch("qualify_extension_runtime.queue.Queue.get", new=short_wait):
                caller.start()
                caller.join(timeout=2)
                self.assertFalse(caller.is_alive(), "host timeout did not interrupt stalled stdin")
            self.assertIsInstance(outcomes.get_nowait(), queue.Empty)
            self.assertIsNotNone(process.poll())
            self.assertTrue(all(stream.closed for stream in (process.stdin, process.stdout, process.stderr)))
            self.assertLessEqual(set(threading.enumerate()), previous_threads)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=3)
            caller.join(timeout=3)

    def test_validated_response_receives_ack_eof_without_main_pipe_reads(self):
        root = Path(self.directory.name)
        (root / "pure.wasm").write_bytes(b"fixture")
        (root / "input.json").write_text('{"sourceId":"fixture-source"}')
        self.lab.args.fixtures = str(root)
        self.lab.args.input = str(root / "input.json")
        program = """
import json,struct,sys
def read_frame():
    size = struct.unpack('>I', sys.stdin.buffer.read(4))[0]
    return sys.stdin.buffer.read(size)
request = json.loads(read_frame())
read_frame()
response = {**request, 'status': 'ok', 'output': json.dumps({'schemaVersion':1,
    'sections':[{'sourceIds':['fixture-source']}]})}
encoded = json.dumps(response).encode()
sys.stdout.buffer.write(struct.pack('>I',len(encoded)) + encoded)
sys.stdout.flush()
assert sys.stdin.buffer.read() == b'\\x01'
"""
        process = subprocess.Popen([sys.executable, "-B", "-c", program],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output, caller = process.stdout, threading.current_thread()

        class ThreadOnlyOutput:
            def read(self, size):
                if threading.current_thread() is caller:
                    raise AssertionError("main thread performed a potentially blocking pipe read")
                return output.read(size)

            def close(self):
                output.close()

        process.stdout = ThreadOnlyOutput()
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        self.lab.start = Mock(return_value=(self.name, process))
        self.lab.check_endpoint = Mock()
        self.lab.call = Mock(return_value=subprocess.CompletedProcess([], 1, b"", b"no such container"))
        self.lab.inspect = Mock(return_value={"State": {"ExitCode": 0, "OOMKilled": False}})
        previous_threads = set(threading.enumerate())
        self.lab.worker("pure", "ok")
        self.assertEqual(process.returncode, 0)
        self.assertLessEqual(set(threading.enumerate()), previous_threads)
        self.assertEqual(self.lab.results[0]["status"], "pass")


class EndpointTests(unittest.TestCase):
    def test_preflight_pins_selected_uri_and_identity_before_server_info(self):
        with tempfile.TemporaryDirectory(prefix="ariadne-q-endpoint-") as directory:
            lab = Laboratory(SimpleNamespace(podman="podman", connection="machine",
                image="a" * 64, evidence=directory))
            connection = {"Name": "machine", "IsMachine": True,
                "URI": "ssh://core@127.0.0.1:50042/run/user/501/podman/podman.sock",
                "Identity": "/existing/machine/key"}
            info = {"host": {"security": {"rootless": True, "seccompEnabled": True},
                "cgroupVersion": "v2", "kernel": "test", "arch": "arm64"}, "version": {"Version": "test"}}
            with patch("qualify_extension_runtime.subprocess.run", side_effect=[
                    subprocess.CompletedProcess([], 0, json.dumps([connection]).encode(), b""),
                    subprocess.CompletedProcess([], 0, json.dumps(info).encode(), b"")]) as run:
                lab.preflight()
            self.assertEqual(run.call_args_list[1].args[0][:5],
                ["podman", "--url", connection["URI"], "--identity", connection["Identity"]])
            self.assertEqual(run.call_args_list[0].args[0],
                ["podman", "system", "connection", "list", "--format", "json"])
            self.assertEqual(run.call_args_list[0].kwargs["env"], run.call_args_list[1].kwargs["env"])
            changed = {**connection, "URI": "ssh://other"}
            with patch("qualify_extension_runtime.subprocess.run", return_value=
                    subprocess.CompletedProcess([], 0, json.dumps([changed]).encode(), b"")) as run:
                with self.assertRaisesRegex(RuntimeError, "endpoint changed"):
                    lab.check_endpoint()
                self.assertEqual(run.call_args.args[0][1:3], ["system", "connection"])
            self.assertEqual(lab.prefix, ["podman", "--url", connection["URI"], "--identity", connection["Identity"]])



if __name__ == "__main__":
    unittest.main()
