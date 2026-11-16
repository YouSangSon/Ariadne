//! Trusted stateless engine entrypoint; OS capabilities stay outside the library.
use ariadne_compute::{cochange, protocol};
use std::io::{Read, Write};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Computing,
    Writing,
    Flushed,
    Closed,
    Fatal,
}
struct State {
    phase: Phase,
    eof_pending: bool,
}
enum Event {
    Prepared(Result<Vec<u8>, ()>),
    Tail,
    Written,
}
fn fatal() -> ! {
    std::process::exit(1)
}
fn main() {
    // Fatal exit terminates blocked stateless threads; it is not a thread join.
    std::panic::set_hook(Box::new(|_| std::process::exit(1)));
    let (stop, stopped) = mpsc::channel();
    let watchdog = thread::spawn(move || {
        if stopped.recv_timeout(Duration::from_secs(30)).is_err() {
            fatal()
        }
    });
    let mut input = std::io::stdin();
    let mut prefix = [0; 4];
    if input.read_exact(&mut prefix).is_err() {
        fatal()
    }
    let length = u32::from_be_bytes(prefix) as usize;
    if length == 0 || length > protocol::MAX_REQUEST_BYTES {
        fatal()
    }
    let mut raw = vec![0; length];
    if input.read_exact(&mut raw).is_err() {
        fatal()
    }
    let state = Arc::new(Mutex::new(State {
        phase: Phase::Computing,
        eof_pending: false,
    }));
    let cancelled = Arc::new(AtomicBool::new(false));
    let (send, receive) = mpsc::channel();
    let tail = {
        let state = state.clone();
        let cancelled = cancelled.clone();
        let send = send.clone();
        thread::spawn(move || {
            let mut byte = [0];
            let result = input.read(&mut byte);
            let mut state = state.lock().unwrap();
            match result {
                Ok(0) => match state.phase {
                    Phase::Computing => {
                        state.phase = Phase::Fatal;
                        cancelled.store(true, Ordering::Release)
                    }
                    // EOF and writer completion are synchronized observations, not physical arrival order.
                    Phase::Writing => state.eof_pending = true,
                    Phase::Flushed => state.phase = Phase::Closed,
                    _ => {}
                },
                _ => {
                    state.phase = Phase::Fatal;
                    cancelled.store(true, Ordering::Release)
                }
            }
            drop(state);
            let _ = send.send(Event::Tail);
        })
    };
    let compute = {
        let send = send.clone();
        let cancelled = cancelled.clone();
        thread::spawn(move || {
            let frame = (|| match protocol::decode_request_correlated(&raw) {
                Ok(request) => {
                    let counts = cochange::count_cancellable(&request.input, || {
                        cancelled.load(Ordering::Acquire)
                    })
                    .map_err(|_| ())?;
                    protocol::encode_response(&request, &protocol::Response::Ok(counts))
                        .map_err(|_| ())
                }
                Err(failure) => match failure.correlation {
                    Some(correlation) => {
                        protocol::encode_error(&correlation, failure.code).map_err(|_| ())
                    }
                    None => Err(()),
                },
            })();
            let _ = send.send(Event::Prepared(frame));
        })
    };
    let mut writer = None;
    loop {
        let event = receive.recv().unwrap_or_else(|_| fatal());
        if let Event::Prepared(frame) = event {
            let frame = frame.unwrap_or_else(|_| fatal());
            if frame.len() > protocol::MAX_RESPONSE_BYTES {
                fatal()
            }
            {
                let mut state = state.lock().unwrap();
                if state.phase != Phase::Computing {
                    fatal()
                }
                state.phase = Phase::Writing;
            }
            let state = state.clone();
            let send = send.clone();
            writer = Some(thread::spawn(move || {
                let mut output = std::io::stdout().lock();
                let result = output
                    .write_all(&(frame.len() as u32).to_be_bytes())
                    .and_then(|_| output.write_all(&frame))
                    .and_then(|_| output.flush());
                let mut state = state.lock().unwrap();
                if result.is_err() {
                    state.phase = Phase::Fatal
                } else if state.phase == Phase::Writing {
                    state.phase = if state.eof_pending {
                        Phase::Closed
                    } else {
                        Phase::Flushed
                    }
                }
                drop(state);
                let _ = send.send(Event::Written);
            }));
        }
        let phase = state.lock().unwrap().phase;
        if phase == Phase::Fatal {
            fatal()
        }
        if phase == Phase::Closed {
            break;
        }
    }
    tail.join().unwrap();
    compute.join().unwrap();
    writer.unwrap().join().unwrap();
    let _ = stop.send(());
    watchdog.join().unwrap();
}
