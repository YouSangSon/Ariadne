use ariadne_extension_worker::engine::{Executor, Outcome};

#[test]
fn invalid_component_is_a_structured_failure() {
    assert_eq!(
        Executor::new().unwrap().execute(b"not wasm", b"{}"),
        Outcome::InvalidComponent
    );
}

fn component(body: &str, extra: &str) -> Vec<u8> {
    component_with_output(body, extra, b"{}")
}

fn component_with_output(body: &str, extra: &str, output: &[u8]) -> Vec<u8> {
    let data = output
        .iter()
        .map(|b| format!("\\{b:02x}"))
        .collect::<String>();
    wat::parse_str(format!(r#"(component
      {extra}
      (core module $m
        (memory (export "memory") 2)
        (data (i32.const 1024) "{data}")
        (func (export "realloc") (param i32 i32 i32 i32) (result i32) i32.const 4096)
        (func (export "project") (param i32 i32) (result i32) {body}))
      (core instance $i (instantiate $m))
      (func (export "project") (param "input" (list u8)) (result (result (list u8) (error string)))
        (canon lift (core func $i "project") (memory (core memory $i "memory")) (realloc (core func $i "realloc")))))"#)).unwrap()
}

const OK: &str =
    "i32.const 4 i32.const 1024 i32.store i32.const 8 i32.const 2 i32.store i32.const 0";

#[test]
fn pure_component_returns_bytes() {
    assert_eq!(
        Executor::new().unwrap().execute(&component(OK, ""), b"{}"),
        Outcome::Output(b"{}".to_vec())
    );
}

#[test]
fn no_host_import_is_linked() {
    let wasm = component(OK, "(import \"clock\" (func))");
    assert_eq!(
        Executor::new().unwrap().execute(&wasm, b"{}"),
        Outcome::InvalidComponent
    );
}

#[test]
fn loop_exhausts_fuel() {
    let wasm = component("(loop $forever br $forever) i32.const 0", "");
    assert_eq!(
        Executor::new().unwrap().execute(&wasm, b"{}"),
        Outcome::ResourceLimit
    );
}

#[test]
fn aggregate_memory_is_limited() {
    let extra = "(core module $large (memory 600)) (core instance (instantiate $large)) (core instance (instantiate $large))";
    assert_eq!(
        Executor::new()
            .unwrap()
            .execute(&component(OK, extra), b"{}"),
        Outcome::ResourceLimit
    );
}

#[test]
fn oversized_output_is_not_copied() {
    let body = "i32.const 5 memory.grow drop i32.const 4 i32.const 1024 i32.store i32.const 8 i32.const 262145 i32.store i32.const 0";
    assert_eq!(
        Executor::new()
            .unwrap()
            .execute(&component(body, ""), b"{}"),
        Outcome::InvalidOutput
    );
}

#[test]
fn shared_memory_and_memory64_are_disabled() {
    for memory in ["(memory 1 1 shared)", "(memory i64 1)"] {
        let extra =
            format!("(core module $forbidden {memory}) (core instance (instantiate $forbidden))");
        assert_eq!(
            Executor::new()
                .unwrap()
                .execute(&component(OK, &extra), b"{}"),
            Outcome::InvalidComponent
        );
    }
}

#[test]
fn aggregate_tables_are_limited() {
    let extra = "(core module $large (table 10000 funcref)) (core instance (instantiate $large)) (core instance (instantiate $large))";
    assert_eq!(
        Executor::new()
            .unwrap()
            .execute(&component(OK, extra), b"{}"),
        Outcome::ResourceLimit
    );
}

#[test]
fn guest_error_is_not_returned() {
    let body = "i32.const 0 i32.const 1 i32.store i32.const 4 i32.const 1024 i32.store i32.const 8 i32.const 2 i32.store i32.const 0";
    assert_eq!(
        Executor::new()
            .unwrap()
            .execute(&component(body, ""), b"{}"),
        Outcome::InvalidOutput
    );
}

#[test]
fn stack_overflow_is_bounded() {
    let extra = "(core module $recursive (func $recurse call $recurse) (start $recurse)) (core instance (instantiate $recursive))";
    assert_eq!(
        Executor::new()
            .unwrap()
            .execute(&component(OK, extra), b"{}"),
        Outcome::ResourceLimit
    );
}

#[test]
#[ignore = "writes raw components only to explicit task-owned qualification directory"]
fn export_qualification_fixtures() {
    let directory = std::path::PathBuf::from(
        std::env::var_os("ARIADNE_FIXTURE_DIR").expect("ARIADNE_FIXTURE_DIR"),
    );
    assert!(directory.is_absolute());
    std::fs::create_dir_all(&directory).unwrap();
    let cases = [
        ("pure", {
            let output = br#"{"schemaVersion":1,"sections":[{"title":"Derived report","body":"Untrusted extension output","sourceIds":["comparison-01"]}]}"#;
            let body = OK.replace(
                "i32.const 2 i32.store",
                &format!("i32.const {} i32.store", output.len()),
            );
            component_with_output(&body, "", output)
        }),
        (
            "loop",
            component("(loop $forever br $forever) i32.const 0", ""),
        ),
        ("import", component(OK, "(import \"clock\" (func))")),
        (
            "memory",
            component(
                OK,
                "(core module $large (memory 600)) (core instance (instantiate $large)) (core instance (instantiate $large))",
            ),
        ),
        (
            "output",
            component(
                "i32.const 5 memory.grow drop i32.const 4 i32.const 1024 i32.store i32.const 8 i32.const 262145 i32.store i32.const 0",
                "",
            ),
        ),
    ];
    for (name, wasm) in cases {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join(format!("{name}.wasm")))
            .unwrap();
        file.write_all(&wasm).unwrap();
    }
}
