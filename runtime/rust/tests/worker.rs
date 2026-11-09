use ariadne_extension_worker::{domain::*, protocol::*};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

struct Worker(std::process::Child);

impl std::ops::Deref for Worker {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for Worker {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

fn launch() -> Worker {
    Worker(
        Command::new(env!("CARGO_BIN_EXE_ariadne-extension-worker"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    )
}

fn wait(child: &mut std::process::Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("worker did not terminate");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn frames(child: &mut std::process::Child) {
    frames_with_wasm(child, b"bad wasm");
}

fn frames_with_wasm(child: &mut std::process::Child, wasm: &[u8]) {
    let request = Request {
        protocol: PROTOCOL.into(),
        invocation_id: "test_1".into(),
        package_digest: "0".repeat(64),
        input_digest: sha256(b"{}"),
        artifact_digest: sha256(wasm),
        world: WORLD.into(),
        profile_revision: PROFILE.into(),
        input: "{}".into(),
    };
    let stdin = child.stdin.as_mut().unwrap();
    write_frame(stdin, &serde_json::to_vec(&request).unwrap(), MAX_REQUEST).unwrap();
    write_frame(stdin, wasm, MAX_WASM).unwrap();
}

#[test]
fn response_precedes_stdin_eof_and_eof_joins_worker() {
    let mut child = launch();
    frames(&mut child);
    let mut stdout = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let result = read_frame(&mut stdout, MAX_RESPONSE);
        let _ = tx.send(result);
        let mut tail = Vec::new();
        stdout.read_to_end(&mut tail).unwrap();
        tail
    });
    let response = rx.recv_timeout(Duration::from_secs(5));
    if response.is_err() {
        child.kill().unwrap();
        child.wait().unwrap();
        panic!("response waited for stdin EOF");
    }
    let response: serde_json::Value = serde_json::from_slice(&response.unwrap().unwrap()).unwrap();
    assert_eq!(response["code"], "INVALID_COMPONENT");
    assert_eq!(response["invocationId"], "test_1");
    child.stdin.as_mut().unwrap().write_all(&[ACK]).unwrap();
    drop(child.stdin.take());
    assert!(wait(&mut child).success());
    assert!(reader.join().unwrap().is_empty());
}

#[test]
fn extra_byte_and_parent_eof_fail_closed() {
    let mut early = launch();
    drop(early.stdin.take());
    assert!(!wait(&mut early).success());
    let mut extra = launch();
    frames(&mut extra);
    extra.stdin.as_mut().unwrap().write_all(&[0]).unwrap();
    assert!(!wait(&mut extra).success());
}

#[test]
fn eof_cancels_a_backpressured_response() {
    let output = format!("{{}}{}", " ".repeat(MAX_OUTPUT - 2));
    let wasm = wat::parse_str(format!(r#"(component
        (core module $m
          (memory (export "memory") 6)
          (data (i32.const 1024) "{output}")
          (func (export "realloc") (param i32 i32 i32 i32) (result i32) i32.const 350000)
          (func (export "project") (param i32 i32) (result i32)
            i32.const 4 i32.const 1024 i32.store
            i32.const 8 i32.const {MAX_OUTPUT} i32.store i32.const 0))
        (core instance $i (instantiate $m))
        (func (export "project") (param "input" (list u8)) (result (result (list u8) (error string)))
          (canon lift (core func $i "project") (memory (core memory $i "memory")) (realloc (core func $i "realloc")))))"#)).unwrap();
    let mut child = launch();
    frames_with_wasm(&mut child, &wasm);
    let mut stdout = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut header = [0; 4];
        let result = stdout.read_exact(&mut header);
        let _ = tx.send((result, stdout, u32::from_be_bytes(header)));
    });
    let (result, stdout, length) = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("response header");
    result.unwrap();
    assert!(length > 256 * 1024);
    child.stdout = Some(stdout);
    reader.join().unwrap();
    drop(child.stdin.take());
    assert!(!wait(&mut child).success());
}
