use crate::domain::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};

pub const PROTOCOL: &str = "ariadne.extension-worker/1";
pub const ACK: u8 = 0x01;
// JSON strings may expand a decoded byte to a six-byte Unicode escape.
pub const MAX_REQUEST: usize = 6 * MAX_INPUT + 4096;
pub const MAX_RESPONSE: usize = 6 * MAX_OUTPUT + 4096;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol: String,
    pub invocation_id: String,
    pub package_digest: String,
    pub input_digest: String,
    pub artifact_digest: String,
    pub world: String,
    pub profile_revision: String,
    pub input: String,
}

impl Request {
    pub fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_REQUEST {
            return Err("INVALID_REQUEST");
        }
        let request: Self = serde_json::from_slice(bytes).map_err(|_| "INVALID_REQUEST")?;
        if request.protocol != PROTOCOL
            || request.world != WORLD
            || request.profile_revision != PROFILE
            || request.invocation_id.is_empty()
            || request.invocation_id.len() > 128
            || !request
                .invocation_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || [
                &request.package_digest,
                &request.input_digest,
                &request.artifact_digest,
            ]
            .iter()
            .any(|d| !is_digest(d))
            || request.input.len() > MAX_INPUT
            || sha256(request.input.as_bytes()) != request.input_digest
        {
            return Err("INVALID_REQUEST");
        }
        Ok(request)
    }
    pub fn verify_artifact(&self, bytes: &[u8]) -> bool {
        sha256(bytes) == self.artifact_digest
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response<'a> {
    pub protocol: &'a str,
    pub invocation_id: &'a str,
    pub package_digest: &'a str,
    pub input_digest: &'a str,
    pub artifact_digest: &'a str,
    pub world: &'a str,
    pub profile_revision: &'a str,
    pub status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<&'a str>,
}

impl<'a> Response<'a> {
    pub fn new(request: &'a Request, outcome: &'a Outcome) -> Self {
        let (code, output) = match outcome {
            Outcome::Output(bytes) => (None, std::str::from_utf8(bytes).ok()),
            Outcome::InvalidComponent => (Some("INVALID_COMPONENT"), None),
            Outcome::ResourceLimit => (Some("RESOURCE_LIMIT"), None),
            Outcome::InvalidOutput => (Some("INVALID_OUTPUT"), None),
            Outcome::EngineFailed => (Some("ENGINE_FAILED"), None),
            Outcome::Cancelled => (Some("CANCELLED"), None),
        };
        Self {
            protocol: PROTOCOL,
            invocation_id: &request.invocation_id,
            package_digest: &request.package_digest,
            input_digest: &request.input_digest,
            artifact_digest: &request.artifact_digest,
            world: WORLD,
            profile_revision: PROFILE,
            status: if code.is_none() { "ok" } else { "error" },
            code,
            output,
        }
    }
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn read_frame(reader: &mut impl Read, maximum: usize) -> io::Result<Vec<u8>> {
    let mut length = [0; 4];
    reader.read_exact(&mut length)?;
    let length = u32::from_be_bytes(length) as usize;
    if length > maximum {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame limit"));
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

pub fn write_frame(writer: &mut impl Write, bytes: &[u8], maximum: usize) -> io::Result<()> {
    if bytes.len() > maximum {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame limit"));
    }
    writer.write_all(&(bytes.len() as u32).to_be_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()
}
