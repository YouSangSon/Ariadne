// Trusted laboratory fixture only; never a user-code worker or performance benchmark.
use serde_json::{Value, json};
use std::fs;
use std::hint::black_box;
use std::io::{self, Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const CPU_MILLIS: u64 = 3000;

fn main() {
    if run().is_err() {
        eprintln!("qualification OS probe failed");
        std::process::exit(1);
    }
}

fn run() -> Result<(), ()> {
    let mut args = std::env::args_os().skip(1);
    let mode = args.next().ok_or(())?.into_string().map_err(|_| ())?;
    if args.next().is_some() || !["cpu", "pids", "hold", "--cpu-child"].contains(&mode.as_str()) {
        return Err(());
    }
    check_environment()?;
    let observation = match mode.as_str() {
        "cpu" => cpu_probe()?,
        "pids" => pids_probe()?,
        "hold" => {
            let mut byte = [0];
            return match io::stdin().read(&mut byte) {
                Ok(0) => Ok(()),
                _ => Err(()),
            };
        }
        "--cpu-child" => {
            let started = Instant::now();
            let mut counter = 0_u64;
            while started.elapsed() < Duration::from_millis(CPU_MILLIS) {
                counter = black_box(counter.wrapping_add(1));
            }
            return Ok(());
        }
        _ => return Err(()),
    };
    let mut output = serde_json::to_vec(&observation).map_err(|_| ())?;
    output.push(b'\n');
    if output.len() > 16 * 1024 {
        return Err(());
    }
    io::stdout().lock().write_all(&output).map_err(|_| ())
}

fn read(path: &str) -> Result<String, ()> {
    fs::read_to_string(path).map_err(|_| ())
}

fn field<'a>(contents: &'a str, key: &str) -> Result<&'a str, ()> {
    let mut found = None;
    for line in contents.lines() {
        let mut words = line.split_whitespace();
        if words.next() == Some(key) {
            let value = words.next().ok_or(())?;
            if found.replace(value).is_some() || words.next().is_some() {
                return Err(());
            }
        }
    }
    found.ok_or(())
}

fn counter(contents: &str, key: &str) -> Result<u64, ()> {
    let value = field(contents, key)?;
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    value.parse().map_err(|_| ())
}

fn check_environment() -> Result<(), ()> {
    for (path, expected) in [
        ("/sys/fs/cgroup/memory.max", "268435456"),
        ("/sys/fs/cgroup/memory.swap.max", "0"),
        ("/sys/fs/cgroup/cpu.max", "100000 100000"),
        ("/sys/fs/cgroup/pids.max", "32"),
    ] {
        if read(path)?.trim() != expected {
            return Err(());
        }
    }
    let status = read("/proc/self/status")?;
    for key in ["CapInh:", "CapPrm:", "CapEff:", "CapBnd:", "CapAmb:"] {
        if u64::from_str_radix(field(&status, key)?, 16).map_err(|_| ())? != 0 {
            return Err(());
        }
    }
    if field(&status, "NoNewPrivs:")? != "1" || field(&status, "Seccomp:")? != "2" {
        return Err(());
    }
    Ok(())
}

fn limits() -> Value {
    json!({
        "memoryMax": 268435456,
        "memorySwapMax": 0,
        "cpuMax": "100000 100000",
        "pidsMax": 32,
    })
}

#[derive(Default)]
struct Children(Vec<Child>);

impl Children {
    fn spawn(&mut self, mode: &str) -> io::Result<()> {
        let child = Command::new(std::env::current_exe()?)
            .arg(mode)
            .env_clear()
            .stdin(if mode == "hold" {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        self.0.push(child);
        Ok(())
    }

    fn finish(&mut self) -> Result<usize, ()> {
        for child in &mut self.0 {
            drop(child.stdin.take());
        }
        let mut reaped = 0;
        let mut valid = true;
        for child in &mut self.0 {
            match child.wait() {
                Ok(status) => {
                    reaped += 1;
                    valid &= status.success();
                }
                Err(_) => valid = false,
            }
        }
        if !valid {
            return Err(());
        }
        self.0.clear();
        Ok(reaped)
    }
}

impl Drop for Children {
    fn drop(&mut self) {
        // Close every pipe and terminate every child before waiting, including partial failures.
        for child in &mut self.0 {
            drop(child.stdin.take());
            let _ = child.kill();
        }
        for child in &mut self.0 {
            let _ = child.wait();
        }
    }
}

fn cpu_counters() -> Result<(u64, u64), ()> {
    let contents = read("/sys/fs/cgroup/cpu.stat")?;
    Ok((
        counter(&contents, "nr_throttled")?,
        counter(&contents, "throttled_usec")?,
    ))
}

fn cpu_probe() -> Result<Value, ()> {
    let before = cpu_counters()?;
    let mut children = Children::default();
    children.spawn("--cpu-child").map_err(|_| ())?;
    children.spawn("--cpu-child").map_err(|_| ())?;
    let reaped = children.finish()?;
    let after = cpu_counters()?;
    if after.0 <= before.0 || after.1 <= before.1 {
        return Err(());
    }
    Ok(json!({
        "case": "cpu", "limits": limits(),
        "before": {"nr_throttled": before.0, "throttled_usec": before.1},
        "after": {"nr_throttled": after.0, "throttled_usec": after.1},
        "childrenStarted": 2, "childrenReaped": reaped, "wallLimitMillis": CPU_MILLIS,
    }))
}

fn pids_probe() -> Result<Value, ()> {
    let before = counter(&read("/sys/fs/cgroup/pids.events")?, "max")?;
    let mut children = Children::default();
    let mut attempts = 0;
    let mut exhausted = false;
    for _ in 0..40 {
        attempts += 1;
        match children.spawn("hold") {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(11) => {
                exhausted = true;
                break;
            }
            Err(_) => return Err(()),
        }
    }
    let started = children.0.len();
    let reaped = children.finish()?;
    let after = counter(&read("/sys/fs/cgroup/pids.events")?, "max")?;
    if !exhausted || !(1..=31).contains(&started) || after <= before {
        return Err(());
    }
    Ok(json!({
        "case": "pids", "limits": limits(),
        "before": {"max": before}, "after": {"max": after},
        "spawnAttempts": attempts, "spawnFailures": 1, "failureErrno": 11,
        "childrenStarted": started, "childrenReaped": reaped,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_fields_require_one_complete_unsigned_value() {
        let contents = "usage_usec 123\nnr_throttled 2\nthrottled_usec 17\n";
        assert_eq!(counter(contents, "nr_throttled"), Ok(2));
        assert_eq!(counter(contents, "throttled_usec"), Ok(17));
        assert_eq!(counter("max 18446744073709551615\n", "max"), Ok(u64::MAX));
        for invalid in [
            "",
            "max",
            "max -1",
            "max +1",
            "max 1 2",
            "max 1\nmax 2",
            "max 18446744073709551616",
        ] {
            assert!(counter(invalid, "max").is_err());
        }
        assert_eq!(
            field("CapEff:\t0000000000000000\n", "CapEff:"),
            Ok("0000000000000000")
        );
    }
}
