use std::io::{Read, Write};
use std::process::{Command, Stdio};
#[test]
fn actual_binary_returns_one_count_frame_and_exits_after_validated_close() {
    let raw = include_bytes!("../../../../../contracts/compute/v1/fixtures/tiny-request.json");
    let mut child = Command::new(env!("CARGO_BIN_EXE_ariadne-compute"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let write = input
        .write_all(&(raw.len() as u32).to_be_bytes())
        .and_then(|_| input.write_all(raw));
    let mut output = child.stdout.take().unwrap();
    let mut prefix = [0; 4];
    let read = output.read_exact(&mut prefix);
    assert!(
        write.is_ok() && read.is_ok(),
        "compute executable must produce a response while stdin stays open: write={write:?} read={read:?}"
    );
    let mut frame = vec![0; u32::from_be_bytes(prefix) as usize];
    output.read_exact(&mut frame).unwrap();
    let request = ariadne_compute::protocol::decode_request(raw).unwrap();
    assert!(matches!(
        ariadne_compute::protocol::decode_response(&frame, &request),
        Ok(ariadne_compute::protocol::Response::Ok(_))
    ));
    drop(input);
    assert!(child.wait().unwrap().success());
    let mut tail = Vec::new();
    output.read_to_end(&mut tail).unwrap();
    assert!(tail.is_empty());
}

fn engine() -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_ariadne-compute"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}
fn send(child: &mut std::process::Child, raw: &[u8]) {
    let input = child.stdin.as_mut().unwrap();
    input.write_all(&(raw.len() as u32).to_be_bytes()).unwrap();
    input.write_all(raw).unwrap();
}
#[test]
fn actual_engine_rejects_extra_input_before_and_after_response() {
    for after in [false, true] {
        let mut child = engine();
        send(
            &mut child,
            include_bytes!("../../../../../contracts/compute/v1/fixtures/tiny-request.json"),
        );
        if after {
            let out = child.stdout.as_mut().unwrap();
            let mut prefix = [0; 4];
            out.read_exact(&mut prefix).unwrap();
            let mut raw = vec![0; u32::from_be_bytes(prefix) as usize];
            out.read_exact(&mut raw).unwrap();
        }
        let _ = child.stdin.as_mut().unwrap().write_all(&[1]);
        drop(child.stdin.take());
        assert!(!child.wait().unwrap().success());
    }
}
#[test]
fn actual_engine_rejects_immediate_eof_before_any_response() {
    let mut child = engine();
    drop(child.stdin.take());
    assert!(!child.wait().unwrap().success());
    let mut child = engine();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&[0, 0, 0, 20, b'{'])
        .unwrap();
    drop(child.stdin.take());
    assert!(!child.wait().unwrap().success());
}
#[test]
fn actual_engine_invalid_payload_has_bounded_error_frame() {
    for (file, code) in [
        ("reject-request-bad-digest.json", "INVALID_INPUT"),
        ("reject-request-wrong-version.json", "UNSUPPORTED_VERSION"),
        ("reject-request-duplicate-fileCount.json", "INVALID_INPUT"),
    ] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../contracts/compute/v1/fixtures")
            .join(file);
        assert!(path.exists(), "missing fixture {}", path.display());
        let mut child = engine();
        send(&mut child, &std::fs::read(path).unwrap());
        let out = child.stdout.as_mut().unwrap();
        let mut prefix = [0; 4];
        out.read_exact(&mut prefix).unwrap();
        let mut raw = vec![0; u32::from_be_bytes(prefix) as usize];
        out.read_exact(&mut raw).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(value["status"], "error");
        assert_eq!(value["code"], code);
        assert_eq!(value["protocol"], "ariadne.compute/1");
        assert_eq!(value["operation"], "cochange-counts/1");
        drop(child.stdin.take());
        assert!(child.wait().unwrap().success());
    }
}
#[test]
fn parent_proxy() {
    if std::env::var_os("ARIADNE_PARENT_PROXY").is_none() {
        return;
    }
    let mut child = engine();
    send(
        &mut child,
        include_bytes!("../../../../../contracts/compute/v1/fixtures/tiny-request.json"),
    );
    println!("ENGINE_PID={}", child.id());
    std::io::stdout().flush().unwrap();
    // Only this process owns the engine stdin writer. The grandparent never inherits it.
    let mut byte = [0];
    let _ = std::io::stdin().read(&mut byte);
    let _ = child.kill();
    let _ = child.wait();
}
#[cfg(unix)]
#[test]
fn actual_parent_forced_kill_closes_owned_fd_and_engine_exits() {
    use std::io::{BufRead, BufReader};
    let mut parent = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "parent_proxy", "--nocapture"])
        .env("ARIADNE_PARENT_PROXY", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut lines = BufReader::new(parent.stdout.take().unwrap());
    let mut line = String::new();
    let pid = loop {
        line.clear();
        assert!(lines.read_line(&mut line).unwrap() > 0);
        if let Some(pid) = line.trim().strip_prefix("ENGINE_PID=") {
            break pid.to_owned();
        }
    };
    parent.kill().unwrap();
    parent.wait().unwrap();
    drop(parent.stdin.take());
    let start = std::time::Instant::now();
    loop {
        let output = Command::new("ps")
            .args(["-o", "stat=", "-p", &pid])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() || state.trim().is_empty() {
            break;
        }
        // An orphan may be reaped asynchronously by init; Z proves exit, not disappearance.
        assert!(
            start.elapsed() < std::time::Duration::from_secs(35),
            "engine PID {pid} remains: {state}"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}
#[test]
fn actual_backpressure_eof_is_bounded_by_whole_lifetime_watchdog() {
    let input = ariadne_compute::cochange::CoChangeInput {
        file_count: 37500,
        commits: (0..1500)
            .map(|c| (0..25).map(|i| c * 25 + i).collect())
            .collect(),
    };
    let request = ariadne_compute::protocol::new_request("backpressure", input).unwrap();
    let raw = ariadne_compute::protocol::encode_request(&request).unwrap();
    let start = std::time::Instant::now();
    let mut child = engine();
    send(&mut child, &raw);
    let mut prefix = [0; 4];
    child
        .stdout
        .as_mut()
        .unwrap()
        .read_exact(&mut prefix)
        .unwrap();
    assert!(u32::from_be_bytes(prefix) > 65536);
    drop(child.stdin.take()); // Stop reading stdout: writer is blocked, EOF is pending in Writing.
    assert!(!child.wait().unwrap().success());
    assert!(start.elapsed() < std::time::Duration::from_secs(35));
}

#[test]
fn actual_full_request_eof_cancels_before_response_or_watchdog() {
    let input = ariadne_compute::cochange::CoChangeInput {
        file_count: 37500,
        commits: (0..1500)
            .map(|c| (0..25).map(|i| c * 25 + i).collect())
            .collect(),
    };
    let request = ariadne_compute::protocol::new_request("prewrite-eof", input).unwrap();
    let raw = ariadne_compute::protocol::encode_request(&request).unwrap();
    let mut child = engine();
    send(&mut child, &raw);
    drop(child.stdin.take());
    assert!(!child.wait().unwrap().success());
}
#[test]
fn actual_closed_output_never_succeeds() {
    let mut child = engine();
    drop(child.stdout.take());
    send(
        &mut child,
        include_bytes!("../../../../../contracts/compute/v1/fixtures/tiny-request.json"),
    );
    drop(child.stdin.take());
    assert!(!child.wait().unwrap().success());
}

#[test]
fn shared_process_error_policy_matches_actual_binary() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../contracts/compute/v1/fixtures");
    let cases: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("cases.json")).unwrap()).unwrap();
    for case in cases["processRequests"].as_array().unwrap() {
        let raw = std::fs::read(root.join(case["file"].as_str().unwrap())).unwrap();
        let mut child = engine();
        send(&mut child, &raw);
        let out = child.stdout.as_mut().unwrap();
        let mut prefix = [0; 4];
        let result = out.read_exact(&mut prefix);
        if case["frame"] == "none" {
            assert!(
                result.is_err(),
                "{} unexpectedly emitted a frame",
                case["name"]
            );
            drop(child.stdin.take());
            assert!(!child.wait().unwrap().success());
            continue;
        }
        result.unwrap();
        let mut frame = vec![0; u32::from_be_bytes(prefix) as usize];
        out.read_exact(&mut frame).unwrap();
        let response: serde_json::Value = serde_json::from_slice(&frame).unwrap();
        assert_eq!(response["code"], case["expectedCode"], "{}", case["name"]);
        assert_eq!(response["status"], "error");
        assert_eq!(response["protocol"], "ariadne.compute/1");
        assert_eq!(response["operation"], "cochange-counts/1");
        drop(child.stdin.take());
        assert!(child.wait().unwrap().success());
    }
}
