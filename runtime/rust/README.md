# Experimental extension worker

This E0 worker is qualification groundwork. Public extension execution remains
unsupported until the host's pinned rootless container profile and lifecycle
have passed their separate qualification. Do not run arbitrary guest code as a
native subprocess outside that profile.

The binary accepts one big-endian u32-length JSON request followed by one
u32-length raw Component Model WASM frame on stdin. The request fields are
`protocol`, `invocationId`, `packageDigest`, `inputDigest`, `artifactDigest`,
`world`, `profileRevision`, and `input` (the exact UTF-8 JSON bytes as a string).
Protocol is `ariadne.extension-worker/1`, world is
`ariadne:extensions/report-projector@1.0.0`, and profile is `e0-1`.
Both actual artifact and decoded input bytes must match their SHA-256 digests.
Package digest is correlated only; package validation belongs to the host.
Decoded input/output limits are 1 MiB/256 KiB; outer JSON frames allow six times
those sizes plus 4 KiB for JSON escaping and envelope fields. Raw WASM is 8 MiB.

One response frame repeats every correlation field, with `status: ok` and
`output`, or `status: error` and a fixed error `code`. Guest error text and
backtraces are never emitted. The host validates the projection JSON schema and
source references. Invalid framing/envelopes exit nonzero without a response.
The host keeps stdin open until it reads and validates the complete response,
then sends exactly one ACK byte `0x01`, closes stdin, and waits for stdout EOF
and process/container termination. EOF without ACK cancels immediately, even
while stdout is blocked. ACK before response start or any additional input byte
causes nonzero termination, including after a response. The ACK attests the
trusted host's complete response validation; the worker cannot infer that from
an output write alone.

Pinned Wasmtime has only `std`, `runtime`, `cranelift`, and `component-model`
features. No WASI or native/AOT deserialization is linked. Only an import-free
component with the single correctly typed `project` export is accepted. Fuel is
10,000,000; epoch interruption and a 30-second process watchdog supplement the
mandatory external deadline. The store limits memory to 64 MiB in aggregate,
tables to 16,384 elements in aggregate, 16 memories/tables, 64 instances, and a
1 MiB Wasm stack. Memory reservations remain charged after failed growth,
conservatively reducing the remaining budget. These limits do not bound compiler
RSS or replace container memory/CPU/PID limits.

Use task-owned `CARGO_HOME` and `CARGO_TARGET_DIR`, with `CARGO_BUILD_JOBS=2`:

```sh
cargo test --locked --manifest-path runtime/rust/Cargo.toml
cargo test --locked --manifest-path runtime/rust/Cargo.toml --example qualification-os-probe
cargo fmt --manifest-path runtime/rust/Cargo.toml -- --check
cargo clippy --locked --manifest-path runtime/rust/Cargo.toml --all-targets -- -D warnings
```

The ignored `export_qualification_fixtures` integration test creates raw fixture
components only in an explicitly selected absolute `ARIADNE_FIXTURE_DIR`.
Files use exclusive creation. This is test tooling and is absent from the worker
binary. Domain values, Wasmtime adapter, protocol adapter, and binary composition
have separate ownership and a scoped `syn` AST dependency check.

The WIT contract test parses and resolves the published source with the exact
`wit-parser` version already in the Wasmtime lockfile, then checks its world and
single import-free function against the worker signature. Negative cases cover
syntax, world/version, import/export and input/result drift. This is a source
contract gate, not generated SDK bindings or a guarantee for arbitrary languages.

The qualification image also contains `qualification-os-probe`, a trusted test
fixture. Its fixed CPU/PID modes first require the exact cgroup limits and zero
capabilities. They create at most two finite CPU workers or 40 direct process
creation attempts, reap every child, and report kernel counter changes. This
fixture is not part of the worker protocol or a public execution capability.
The host releases each probe only after inspect; stdin EOF before that release
must not start load. Production worker behavior and its no-import contract stay
unchanged. Never run the load fixture directly on the host.
