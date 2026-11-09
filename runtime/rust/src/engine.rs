pub use crate::domain::Outcome;
use crate::domain::*;
use std::sync::mpsc;
use std::time::Duration;
use wasmtime::component::{Component, Linker, WasmList, WasmStr};
use wasmtime::{Config, Engine, ResourceLimiter, Store, Trap};

#[derive(Default)]
struct Budget {
    memory: usize,
    table: usize,
    denied: bool,
}

impl ResourceLimiter for Budget {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        if maximum.is_some_and(|m| desired > m) || desired - current > MEMORY_BYTES - self.memory {
            self.denied = true;
            return Err(wasmtime::Error::msg("memory limit"));
        }
        self.memory += desired - current;
        Ok(true)
    }
    fn table_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        if maximum.is_some_and(|m| desired > m) || desired - current > TABLE_ELEMENTS - self.table {
            self.denied = true;
            return Err(wasmtime::Error::msg("table limit"));
        }
        self.table += desired - current;
        Ok(true)
    }
    fn instances(&self) -> usize {
        64
    }
    fn memories(&self) -> usize {
        16
    }
    fn tables(&self) -> usize {
        16
    }
}

pub struct Executor {
    engine: Engine,
}

impl Executor {
    pub fn new() -> wasmtime::Result<Self> {
        let mut config = Config::new();
        // Threads/shared memory are unavailable because the threads crate feature is disabled.
        config
            .consume_fuel(true)
            .epoch_interruption(true)
            .max_wasm_stack(1024 * 1024)
            .wasm_component_model(true)
            .wasm_memory64(false)
            .wasm_simd(false)
            .wasm_relaxed_simd(false)
            .wasm_tail_call(false)
            .wasm_extended_const(false)
            .wasm_backtrace(false);
        Ok(Self {
            engine: Engine::new(&config)?,
        })
    }

    pub fn execute(&self, wasm: &[u8], input: &[u8]) -> Outcome {
        if wasm.len() > MAX_WASM
            || wasm.get(..8) != Some(b"\0asm\x0d\0\x01\0")
            || input.len() > MAX_INPUT
        {
            return Outcome::InvalidComponent;
        }
        let engine = self.engine.clone();
        let (stop, stopped) = mpsc::channel();
        let ticker = std::thread::spawn(move || {
            while matches!(
                stopped.recv_timeout(Duration::from_millis(10)),
                Err(mpsc::RecvTimeoutError::Timeout)
            ) {
                engine.increment_epoch();
            }
        });
        let result = self.run(wasm, input);
        let _ = stop.send(());
        let _ = ticker.join();
        result
    }

    fn run(&self, wasm: &[u8], input: &[u8]) -> Outcome {
        // Only compile raw bytes. Never deserialize native code or load from a guest path.
        let component = match Component::new(&self.engine, wasm) {
            Ok(component) => component,
            Err(_) => return Outcome::InvalidComponent,
        };
        let ty = component.component_type();
        if ty.imports(&self.engine).len() != 0
            || ty.exports(&self.engine).len() != 1
            || ty.exports(&self.engine).next().map(|(name, _)| name) != Some("project")
        {
            return Outcome::InvalidComponent;
        }
        let mut store = Store::new(&self.engine, Budget::default());
        store.limiter(|budget| budget);
        if store.set_fuel(FUEL).is_err() {
            return Outcome::EngineFailed;
        }
        store.set_epoch_deadline(3000);
        let linker = Linker::new(&self.engine);
        let instance = match linker.instantiate(&mut store, &component) {
            Ok(instance) => instance,
            Err(error) => return failure(&store, &error),
        };
        let project = match instance
            .get_typed_func::<(&[u8],), (Result<WasmList<u8>, WasmStr>,)>(&mut store, "project")
        {
            Ok(func) => func,
            Err(_) => return Outcome::InvalidComponent,
        };
        let result = match project.call(&mut store, (input,)) {
            Ok((Ok(bytes),)) if bytes.len() <= MAX_OUTPUT => {
                let bytes = bytes.as_le_slice(&store);
                if std::str::from_utf8(bytes).is_ok() {
                    Outcome::Output(bytes.to_vec())
                } else {
                    Outcome::InvalidOutput
                }
            }
            Ok(_) => Outcome::InvalidOutput,
            Err(error) => return failure(&store, &error),
        };
        if let Err(error) = project.post_return(&mut store) {
            return failure(&store, &error);
        }
        result
    }
}

fn failure(store: &Store<Budget>, error: &wasmtime::Error) -> Outcome {
    if store.data().denied
        || matches!(
            error.downcast_ref::<Trap>(),
            Some(Trap::OutOfFuel | Trap::Interrupt | Trap::StackOverflow)
        )
    {
        Outcome::ResourceLimit
    } else {
        Outcome::InvalidComponent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_deadline_traps_without_fuel_exhaustion() {
        let executor = Executor::new().unwrap();
        let wasm =
            wat::parse_str("(module (func (export \"run\") (loop $loop br $loop)))").unwrap();
        let module = wasmtime::Module::new(&executor.engine, wasm).unwrap();
        let mut store = Store::new(&executor.engine, Budget::default());
        store.set_fuel(u64::MAX).unwrap();
        store.set_epoch_deadline(1);
        let instance = wasmtime::Instance::new(&mut store, &module, &[]).unwrap();
        let run = instance
            .get_typed_func::<(), ()>(&mut store, "run")
            .unwrap();
        executor.engine.increment_epoch();
        let error = run.call(&mut store, ()).unwrap_err();
        assert_eq!(error.downcast_ref::<Trap>(), Some(&Trap::Interrupt));
        assert!(store.get_fuel().unwrap() > 10_000_000);
    }
}
