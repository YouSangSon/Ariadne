use ariadne_extension_worker::{domain::*, engine::Executor, protocol::*};
use std::io::{self, BufReader, Read};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

fn main() {
    // Covers blocked input/output and compilation; OS/container limits remain mandatory.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(30));
        std::process::exit(124);
    });
    if run().is_err() {
        std::process::exit(1);
    }
}

fn run() -> Result<(), ()> {
    let mut stdin = BufReader::new(io::stdin());
    let request =
        Request::parse(&read_frame(&mut stdin, MAX_REQUEST).map_err(|_| ())?).map_err(|_| ())?;
    let wasm = read_frame(&mut stdin, MAX_WASM).map_err(|_| ())?;
    if !request.verify_artifact(&wasm) {
        return Err(());
    }
    let response_started = Arc::new(AtomicBool::new(false));
    let tail_started = response_started.clone();
    let tail = std::thread::spawn(move || {
        let mut byte = [0];
        // A trusted host ACKs only after reading and validating the complete response.
        if stdin.read_exact(&mut byte).is_err()
            || byte != [ACK]
            || !tail_started.load(Ordering::Acquire)
        {
            std::process::exit(2);
        }
        if !matches!(stdin.read(&mut byte), Ok(0)) {
            std::process::exit(2);
        }
    });
    let executor = Executor::new().map_err(|_| ())?;
    let mut outcome = executor.execute(&wasm, request.input.as_bytes());
    let mut response = serde_json::to_vec(&Response::new(&request, &outcome)).map_err(|_| ())?;
    if response.len() > MAX_RESPONSE {
        outcome = Outcome::InvalidOutput;
        response = serde_json::to_vec(&Response::new(&request, &outcome)).map_err(|_| ())?;
    }
    response_started.store(true, Ordering::Release);
    write_frame(&mut io::stdout().lock(), &response, MAX_RESPONSE).map_err(|_| ())?;
    tail.join().map_err(|_| ())?;
    Ok(())
}
