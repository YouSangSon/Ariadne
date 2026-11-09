pub const MAX_INPUT: usize = 1024 * 1024;
pub const MAX_OUTPUT: usize = 256 * 1024;
pub const MAX_WASM: usize = 8 * 1024 * 1024;
pub const MEMORY_BYTES: usize = 64 * 1024 * 1024;
pub const TABLE_ELEMENTS: usize = 16_384;
pub const FUEL: u64 = 10_000_000;
pub const WORLD: &str = "ariadne:extensions/report-projector@1.0.0";
pub const PROFILE: &str = "e0-1";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Output(Vec<u8>),
    InvalidComponent,
    ResourceLimit,
    InvalidOutput,
    EngineFailed,
    Cancelled,
}
