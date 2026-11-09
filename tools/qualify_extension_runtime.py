"""Explicit E0 laboratory; never installs or authorizes a user extension."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import struct
import subprocess
import threading
import time
import uuid
from urllib.parse import urlparse


def verify_profile(item, image):
    host = item.get("HostConfig", {})
    expected = {"Memory": 268435456, "MemorySwap": 268435456,
                "PidsLimit": 32, "NetworkMode": "none", "ReadonlyRootfs": True,
                "Privileged": False, "AutoRemove": False}
    if any(host.get(key) != value for key, value in expected.items()):
        raise ValueError("container isolation/resource profile mismatch")
    if item.get("Image", "").removeprefix("sha256:") != image:
        raise ValueError("container image identity mismatch")
    if item.get("Config", {}).get("User") != "65532:65532":
        raise ValueError("container user mismatch")
    if host.get("Binds") or host.get("LogConfig", {}).get("Type") != "none":
        raise ValueError("host bind or persistent container log enabled")
    # Podman expands --cap-drop=all to its exact default capability set.
    expanded = {"CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_FOWNER", "CAP_FSETID",
                "CAP_KILL", "CAP_NET_BIND_SERVICE", "CAP_SETFCAP", "CAP_SETGID",
                "CAP_SETPCAP", "CAP_SETUID", "CAP_SYS_CHROOT"}
    dropped = {value.upper() for value in host.get("CapDrop", [])}
    if host.get("CapAdd") != [] or dropped not in ({"ALL"}, expanded):
        raise ValueError("container capabilities not dropped")
    if "no-new-privileges" not in host.get("SecurityOpt", []):
        raise ValueError("no-new-privileges missing")
    if host.get("RestartPolicy", {}).get("Name") not in ("", "no"):
        raise ValueError("container restart enabled")
    cpu_quota = host.get("CpuQuota") == 100000 and host.get("CpuPeriod") == 100000
    if not cpu_quota and host.get("NanoCpus") != 1000000000:
        raise ValueError("CPU quota missing")


def verify_os_profile(lines):
    if lines[:4] != ["268435456", "0", "100000 100000", "32"]:
        raise ValueError("actual cgroup limits mismatch")
    status = dict(line.split(":", 1) for line in lines[4:])
    capabilities = {"CapEff", "CapBnd", "CapPrm", "CapInh", "CapAmb"}
    if (len(lines) != 11 or set(status) != capabilities | {"NoNewPrivs", "Seccomp"}
            or any(int(status[key].strip(), 16) != 0 for key in capabilities)
            or status["NoNewPrivs"].strip() != "1" or status["Seccomp"].strip() != "2"):
        raise ValueError("actual capabilities/no-new-privileges/seccomp mismatch")


def frame(value):
    return struct.pack(">I", len(value)) + value


def digest(value):
    return hashlib.sha256(value).hexdigest()


class Laboratory:
    def __init__(self, args):
        self.args = args
        self.discovery_prefix = [args.podman]
        self.prefix = None
        self.environment = {k: v for k, v in os.environ.items() if not k.startswith("CONTAINER")}
        self.owned = set()
        self.container_ids = {}
        self.cleanup = []
        self.results = []
        self.run_id = uuid.uuid4().hex[:16]
        self.evidence = Path(args.evidence)
        self.evidence.mkdir(parents=True, exist_ok=True)

    def call(self, *args, timeout=15, check=True, discovery=False):
        prefix = self.discovery_prefix if discovery else self.prefix
        if prefix is None:
            raise RuntimeError("qualification endpoint not pinned")
        result = subprocess.run(prefix + list(args), capture_output=True,
                                timeout=timeout, env=self.environment)
        if check and result.returncode:
            raise RuntimeError("Podman operation failed: " + args[0])
        return result

    def inspect(self, name):
        return json.loads(self.call("inspect", name).stdout)[0]

    def preflight(self):
        connections = json.loads(self.call("system", "connection", "list", "--format", "json", discovery=True).stdout)
        match = [c for c in connections if c["Name"] == self.args.connection]
        if len(match) != 1:
            raise RuntimeError("explicit connection unavailable")
        uri = urlparse(match[0]["URI"])
        if not match[0].get("IsMachine") or uri.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise RuntimeError("qualification requires an explicit same-device Podman machine")
        identity = match[0].get("Identity")
        if uri.scheme != "ssh" or not isinstance(identity, str) or not identity:
            raise RuntimeError("qualification requires existing SSH identity metadata")
        self.prefix = [self.args.podman, "--url", match[0]["URI"], "--identity", identity]
        info = json.loads(self.call("info", "--format", "json").stdout)
        host = info["host"]
        if not (host["security"]["rootless"] and host["security"]["seccompEnabled"]
                and host["cgroupVersion"] == "v2"):
            raise RuntimeError("rootless/cgroup-v2/seccomp qualification prerequisites missing")
        self.server = {"uri": match[0]["URI"], "identity": identity, "version": info["version"]["Version"],
                       "kernel": host["kernel"], "arch": host["arch"], "rootless": True}

    def check_endpoint(self):
        connections = json.loads(self.call("system", "connection", "list", "--format", "json", discovery=True).stdout)
        current = [c for c in connections if c["Name"] == self.args.connection]
        if (len(current) != 1 or current[0]["URI"] != self.server["uri"]
                or current[0].get("Identity") != self.server.get("identity")):
            raise RuntimeError("qualification endpoint changed")

    def start(self, kind, shell=None):
        self.check_endpoint()
        name = "ariadne-q-" + self.run_id + "-" + kind
        command = json.loads(subprocess.check_output([self.args.profile, name, self.args.image], timeout=5))
        if shell is not None:
            command[command.index("--entrypoint=/usr/local/bin/ariadne-extension-worker")] = "--entrypoint=/bin/sh"
            command += ["-c", shell]
        # The intent precedes creation; cleanup never acts on name alone.
        self.owned.add(name)
        self.save()
        process = subprocess.Popen(self.prefix + command, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=self.environment)
        try:
            deadline = time.monotonic() + 10
            while True:
                probe = self.call("inspect", name, check=False)
                if probe.returncode == 0:
                    item = json.loads(probe.stdout)[0]
                    if item.get("Config", {}).get("Labels", {}).get("io.ariadne.qualification") != name:
                        raise RuntimeError("container ownership mismatch")
                    self.container_ids[name] = item["Id"]
                    (self.evidence / (kind + "-inspect.json")).write_text(json.dumps(item, indent=2) + "\n")
                    verify_profile(item, self.args.image)
                    if item["State"]["Running"]:
                        return name, process
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("container did not reach inspected running state")
                time.sleep(0.05)
        except BaseException:
            self.dispose(name, process)
            raise

    def dispose(self, name, process=None, threads=()):
        try:
            self.check_endpoint()
            probe = self.call("inspect", name, check=False)
            if probe.returncode == 0:
                item = json.loads(probe.stdout)[0]
                if item.get("Config", {}).get("Labels", {}).get("io.ariadne.qualification") != name:
                    raise RuntimeError("cleanup ownership mismatch")
                if item["Id"] != self.container_ids.setdefault(name, item["Id"]):
                    raise RuntimeError("cleanup container identity mismatch")
                if item["State"]["Running"]:
                    self.call("kill", item["Id"])
                self.call("wait", item["Id"])
                final = self.inspect(name)
                if (final["Id"] != item["Id"] or final.get("Config", {}).get("Labels", {}).get("io.ariadne.qualification") != name
                        or final["State"]["Running"]):
                    raise RuntimeError("container termination unconfirmed")
                self.check_endpoint()
                self.call("rm", item["Id"])
                removed = self.call("inspect", item["Id"], check=False)
                if removed.returncode == 0 or b"no such" not in removed.stderr.lower():
                    raise RuntimeError("container removal unconfirmed")
                self.cleanup.append({"name": name, "id": item["Id"], "label": name,
                                     "terminated": True, "removed": True})
            elif b"no such" not in probe.stderr.lower():
                raise RuntimeError("unable to confirm owned container state")
            self.owned.discard(name)
        finally:
            if process:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
                for thread in threads:
                    thread.join(timeout=2)
                active_threads = any(thread.is_alive() for thread in threads)
                for stream in (() if active_threads else (process.stdin, process.stdout, process.stderr)):
                    if stream:
                        try:
                            stream.close()
                        except BrokenPipeError:
                            pass  # The terminated child can no longer consume a buffered write.
            self.save()
            if process and active_threads:
                raise RuntimeError("I/O threads did not terminate")

    def save(self):
        path = self.evidence / "qualification.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"runId": self.run_id, "image": self.args.image,
            "server": getattr(self, "server", None), "results": self.results,
            "cleanup": self.cleanup,
            "unresolvedContainers": sorted(self.owned)}, indent=2) + "\n")
        temporary.replace(path)

    def worker(self, kind, expected):
        wasm = (Path(self.args.fixtures) / (kind + ".wasm")).read_bytes()
        payload = Path(self.args.input).read_bytes()
        request = {"protocol": "ariadne.extension-worker/1", "invocationId": self.run_id,
            "packageDigest": "a" * 64, "inputDigest": digest(payload),
            "artifactDigest": digest(wasm), "world": "ariadne:extensions/report-projector@1.0.0",
            "profileRevision": "e0-1", "input": payload.decode("utf8")}
        name, process = self.start(kind)
        errors, response, eof = bytearray(), queue.Queue(), queue.Queue()
        sent, acknowledged, completed = queue.Queue(), queue.Queue(), queue.Queue()
        deadline = time.monotonic() + 25

        def write_request():
            try:
                process.stdin.write(frame(json.dumps(request).encode()) + frame(wasm))
                process.stdin.flush()
                sent.put(None)
                if acknowledged.get(timeout=max(0, deadline - time.monotonic())):
                    process.stdin.write(b"\x01")
                    process.stdin.flush()
                    process.stdin.close()
                    completed.put(None)
            except BaseException as error:
                sent.put(error)
                completed.put(error)

        def drain():
            while data := process.stderr.read(8192):
                errors.extend(data[:max(0, 65536 - len(errors))])

        def read_response():
            try:
                def exact(length):
                    result = bytearray()
                    while len(result) < length:
                        chunk = process.stdout.read(length - len(result))
                        if not chunk:
                            raise RuntimeError("truncated response")
                        result.extend(chunk)
                    return bytes(result)
                size = struct.unpack(">I", exact(4))[0]
                if size > 6 * 262144 + 4096:
                    raise RuntimeError("response frame exceeds limit")
                message = json.loads(exact(size))
                response.put(message)
                eof.put(process.stdout.read(1))
            except BaseException as error:
                response.put(error)
                eof.put(error)

        stderr_reader = threading.Thread(target=drain, daemon=True)
        stdout_reader = threading.Thread(target=read_response, daemon=True)
        stdin_writer = threading.Thread(target=write_request, daemon=True)
        stderr_reader.start()
        stdout_reader.start()
        stdin_writer.start()
        try:
            write_error = sent.get(timeout=max(0, deadline - time.monotonic()))
            if write_error is not None:
                raise write_error
            message = response.get(timeout=max(0, deadline - time.monotonic()))
            if isinstance(message, BaseException):
                raise message
            for key in ("protocol", "invocationId", "packageDigest", "inputDigest", "artifactDigest", "world", "profileRevision"):
                if message.get(key) != request[key]:
                    raise RuntimeError("response correlation mismatch")
            if message["status"] != expected:
                raise RuntimeError("unexpected worker status")
            expected_code = {"loop": "RESOURCE_LIMIT", "import": "INVALID_COMPONENT",
                             "memory": "RESOURCE_LIMIT", "output": "INVALID_OUTPUT"}.get(kind)
            if expected_code and message.get("code") != expected_code:
                raise RuntimeError("worker failed for a different reason than the tested limit")
            if expected == "ok":
                output = json.loads(message["output"])
                if output["schemaVersion"] != 1 or not output["sections"]:
                    raise RuntimeError("invalid projection fixture result")
                if any(s["sourceIds"] != [json.loads(payload)["sourceId"]] for s in output["sections"]):
                    raise RuntimeError("fixture source mismatch")
            acknowledged.put(True)
            write_error = completed.get(timeout=max(0, deadline - time.monotonic()))
            if write_error is not None:
                raise write_error
            code = process.wait(timeout=min(5, max(0, deadline - time.monotonic())))
            trailing = eof.get(timeout=max(0, deadline - time.monotonic()))
            if isinstance(trailing, BaseException):
                raise trailing
            stdout_reader.join(timeout=min(2, max(0, deadline - time.monotonic())))
            stderr_reader.join(timeout=min(2, max(0, deadline - time.monotonic())))
            if code != 0 or stdout_reader.is_alive() or stderr_reader.is_alive() or trailing:
                raise RuntimeError("worker exit or I/O cleanup failed")
            state = self.inspect(name)["State"]
            self.results.append({"case": kind, "status": "pass", "workerStatus": message["status"],
                "code": message.get("code"), "exitCode": state["ExitCode"], "oomKilled": state.get("OOMKilled")})
        finally:
            acknowledged.put(False)
            self.dispose(name, process, (stdin_writer, stdout_reader, stderr_reader))

    def operating_system(self):
        name, process = self.start("os", "cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max; grep -E '^(Cap(Eff|Bnd|Prm|Inh|Amb)|NoNewPrivs|Seccomp):' /proc/self/status; read ack || :")
        try:
            stdout, stderr = process.communicate(timeout=5)
            lines = stdout.decode().splitlines()
            if process.returncode:
                raise RuntimeError("actual OS probe failed")
            verify_os_profile(lines)
            self.results.append({"case": "actual-cgroup-seccomp", "status": "pass", "observed": lines})
        finally:
            self.dispose(name, process)

    def detached_timeout(self):
        name, process = self.start("parent", "printf 'ariadne-private-marker\\n'; sleep 120")
        marker = queue.Queue()
        reader = threading.Thread(target=lambda: marker.put(process.stdout.readline(64)), daemon=True)
        reader.start()
        try:
            if marker.get(timeout=5) != b"ariadne-private-marker\n":
                raise RuntimeError("attach did not deliver marker with none log driver")
            process.kill()
            process.wait(timeout=3)
            self.call("wait", name, timeout=35)
            state = self.inspect(name)["State"]
            if state["Running"] or state["ExitCode"] == 0:
                raise RuntimeError("container did not stop after attach-parent SIGKILL")
            logs = self.call("logs", name, check=False)
            if b"ariadne-private-marker" in logs.stdout + logs.stderr:
                raise RuntimeError("raw container output persisted")
            if logs.returncode and b"none" not in logs.stderr.lower():
                raise RuntimeError("unable to confirm none-driver log behavior")
            self.results.append({"case": "attach-parent-killed-timeout-no-log", "status": "pass", "exitCode": state["ExitCode"]})
        finally:
            self.dispose(name, process, (reader,))

    def memory_oom(self):
        name, process = self.start("oom", "value=$(head -c 400000000 /dev/zero | tr '\\000' x); printf '%s' \"$value\" > /dev/null")
        try:
            process.communicate(timeout=25)
            state = self.inspect(name)["State"]
            if not state.get("OOMKilled") or state["ExitCode"] == 0:
                raise RuntimeError("actual OS memory exhaustion was not enforced")
            self.results.append({"case": "actual-os-memory-oom", "status": "pass", "exitCode": state["ExitCode"], "oomKilled": True})
        finally:
            self.dispose(name, process)

    def run(self):
        self.preflight()
        try:
            self.operating_system()
            for kind in ("pure", "loop", "import", "memory", "output"):
                self.worker(kind, "ok" if kind == "pure" else "error")
            self.memory_oom()
            self.detached_timeout()
        finally:
            for name in list(self.owned):
                self.dispose(name)
            self.save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("podman", "connection", "image", "profile", "fixtures", "input", "evidence"):
        parser.add_argument("--" + option, required=True)
    Laboratory(parser.parse_args()).run()
