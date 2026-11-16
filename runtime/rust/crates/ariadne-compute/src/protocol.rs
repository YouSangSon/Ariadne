use crate::cochange::{self, CoChangeCounts, CoChangeInput, CountError, PairCount};
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt;

pub const PROTOCOL: &str = "ariadne.compute/1";
pub const OPERATION: &str = "cochange-counts/1";
pub const MAX_REQUEST_BYTES: usize = 16 << 20;
pub const MAX_RESPONSE_BYTES: usize = 32 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidInput,
    UnsupportedVersion,
    LimitExceeded,
    Unavailable,
    Busy,
    Cancelled,
    DeadlineExceeded,
    ProtocolError,
    EngineFailed,
}
impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_INPUT",
            Self::UnsupportedVersion => "UNSUPPORTED_VERSION",
            Self::LimitExceeded => "LIMIT_EXCEEDED",
            Self::Unavailable => "UNAVAILABLE",
            Self::Busy => "BUSY",
            Self::Cancelled => "CANCELLED",
            Self::DeadlineExceeded => "DEADLINE_EXCEEDED",
            Self::ProtocolError => "PROTOCOL_ERROR",
            Self::EngineFailed => "ENGINE_FAILED",
        }
    }
    fn from_str(value: &str) -> Result<Self, Self> {
        [
            Self::InvalidInput,
            Self::UnsupportedVersion,
            Self::LimitExceeded,
            Self::Unavailable,
            Self::Busy,
            Self::Cancelled,
            Self::DeadlineExceeded,
            Self::ProtocolError,
            Self::EngineFailed,
        ]
        .into_iter()
        .find(|code| code.as_str() == value)
        .ok_or(Self::ProtocolError)
    }
}
impl From<CountError> for ErrorCode {
    fn from(error: CountError) -> Self {
        match error {
            CountError::InvalidInput => Self::InvalidInput,
            CountError::LimitExceeded => Self::LimitExceeded,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub request_id: String,
    pub input_digest: String,
    pub input: CoChangeInput,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Response {
    Ok(CoChangeCounts),
    Error(ErrorCode),
}

pub fn canonical_payload(input: &CoChangeInput) -> Result<Vec<u8>, ErrorCode> {
    cochange::validate_input(input)?;
    // An explicit format fixes key order independently of the JSON map implementation.
    Ok(format!(
        "{{\"fileCount\":{},\"commits\":{}}}",
        input.file_count,
        serde_json::to_string(&input.commits).map_err(|_| ErrorCode::InvalidInput)?
    )
    .into_bytes())
}
pub fn new_request(id: &str, input: CoChangeInput) -> Result<Request, ErrorCode> {
    let hash = format!("{:x}", Sha256::digest(canonical_payload(&input)?));
    let request = Request {
        request_id: id.to_owned(),
        input_digest: hash,
        input,
    };
    validate_request(&request)?;
    Ok(request)
}
fn valid_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn valid_digest(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_request(request: &Request) -> Result<(), ErrorCode> {
    if !valid_id(&request.request_id) || !valid_digest(&request.input_digest) {
        return Err(ErrorCode::InvalidInput);
    }
    let hash = format!("{:x}", Sha256::digest(canonical_payload(&request.input)?));
    if hash != request.input_digest {
        return Err(ErrorCode::InvalidInput);
    }
    Ok(())
}
pub fn encode_request(request: &Request) -> Result<Vec<u8>, ErrorCode> {
    validate_request(request)?;
    serde_json::to_vec(&serde_json::json!({"protocol":PROTOCOL,"operation":OPERATION,"requestId":request.request_id,"inputDigest":request.input_digest,
        "payload":{"fileCount":request.input.file_count,"commits":request.input.commits}})).map_err(|_|ErrorCode::InvalidInput)
}
pub fn decode_request(raw: &[u8]) -> Result<Request, ErrorCode> {
    let value = parse(raw, MAX_REQUEST_BYTES)?;
    let fields = object(
        &value,
        &[
            "protocol",
            "operation",
            "requestId",
            "inputDigest",
            "payload",
        ],
    )?;
    let (id, digest) = correlation(fields)?;
    let payload = object(&fields["payload"], &["fileCount", "commits"])?;
    let file_count = number(&payload["fileCount"])?;
    let commits = array(&payload["commits"])?;
    if file_count > cochange::MAX_FILES || commits.len() > cochange::MAX_COMMITS {
        return Err(ErrorCode::LimitExceeded);
    }
    let mut input = CoChangeInput {
        file_count,
        commits: Vec::with_capacity(commits.len()),
    };
    for commit in commits {
        let ids = array(commit)?;
        if ids.len() > cochange::MAX_FILES_PER_COMMIT {
            return Err(ErrorCode::LimitExceeded);
        }
        input
            .commits
            .push(ids.iter().map(number).collect::<Result<Vec<_>, _>>()?);
    }
    let request = Request {
        request_id: id.to_owned(),
        input_digest: digest.to_owned(),
        input,
    };
    validate_request(&request)?;
    Ok(request)
}
fn correlation(fields: &BTreeMap<String, Value>) -> Result<(&str, &str), ErrorCode> {
    let protocol = string(fields.get("protocol").ok_or(ErrorCode::InvalidInput)?)?;
    let operation = string(fields.get("operation").ok_or(ErrorCode::InvalidInput)?)?;
    if protocol != PROTOCOL || operation != OPERATION {
        return Err(ErrorCode::UnsupportedVersion);
    }
    let id = string(fields.get("requestId").ok_or(ErrorCode::InvalidInput)?)?;
    let digest = string(fields.get("inputDigest").ok_or(ErrorCode::InvalidInput)?)?;
    if !valid_id(id) || !valid_digest(digest) {
        return Err(ErrorCode::InvalidInput);
    }
    Ok((id, digest))
}
pub fn encode_response(expected: &Request, response: &Response) -> Result<Vec<u8>, ErrorCode> {
    validate_request(expected)?;
    let mut value = serde_json::json!({"protocol":PROTOCOL,"operation":OPERATION,"requestId":expected.request_id,"inputDigest":expected.input_digest});
    match response {
        Response::Error(code) => {
            value["status"] = "error".into();
            value["code"] = code.as_str().into();
        }
        Response::Ok(counts) => {
            cochange::validate_counts(&expected.input, counts)?;
            value["status"] = "ok".into();
            value["frequencies"] = serde_json::json!(counts.frequencies);
            value["pairs"] = serde_json::json!(
                counts
                    .pairs
                    .iter()
                    .map(|p| [p.a, p.b, p.count, p.first_seen_ordinal])
                    .collect::<Vec<_>>()
            );
        }
    }
    serde_json::to_vec(&value).map_err(|_| ErrorCode::ProtocolError)
}
pub fn decode_response(raw: &[u8], expected: &Request) -> Result<Response, ErrorCode> {
    validate_request(expected)?;
    decode_response_value(raw, expected).map_err(|error| {
        if error == ErrorCode::LimitExceeded {
            error
        } else {
            ErrorCode::ProtocolError
        }
    })
}
fn decode_response_value(raw: &[u8], expected: &Request) -> Result<Response, ErrorCode> {
    let value = parse(raw, MAX_RESPONSE_BYTES)?;
    let Value::Object(fields) = &value else {
        return Err(ErrorCode::ProtocolError);
    };
    let (id, digest) = correlation(fields)?;
    if id != expected.request_id || digest != expected.input_digest {
        return Err(ErrorCode::ProtocolError);
    }
    match string(fields.get("status").ok_or(ErrorCode::ProtocolError)?)? {
        "error" => {
            let fields = object(
                &value,
                &[
                    "protocol",
                    "operation",
                    "requestId",
                    "inputDigest",
                    "status",
                    "code",
                ],
            )?;
            Ok(Response::Error(ErrorCode::from_str(string(
                &fields["code"],
            )?)?))
        }
        "ok" => {
            let fields = object(
                &value,
                &[
                    "protocol",
                    "operation",
                    "requestId",
                    "inputDigest",
                    "status",
                    "frequencies",
                    "pairs",
                ],
            )?;
            let frequencies = array(&fields["frequencies"])?;
            let pairs = array(&fields["pairs"])?;
            if frequencies.len() != expected.input.file_count as usize {
                return Err(ErrorCode::ProtocolError);
            }
            if pairs.len() > cochange::MAX_PAIRS {
                return Err(ErrorCode::LimitExceeded);
            }
            let mut counts = CoChangeCounts {
                frequencies: frequencies
                    .iter()
                    .map(number)
                    .collect::<Result<Vec<_>, _>>()?,
                pairs: Vec::with_capacity(pairs.len()),
            };
            for pair in pairs {
                let tuple = array(pair)?;
                if tuple.len() != 4 {
                    return Err(ErrorCode::ProtocolError);
                }
                counts.pairs.push(PairCount {
                    a: number(&tuple[0])?,
                    b: number(&tuple[1])?,
                    count: number(&tuple[2])?,
                    first_seen_ordinal: number(&tuple[3])?,
                });
            }
            cochange::validate_counts(&expected.input, &counts)?;
            Ok(Response::Ok(counts))
        }
        _ => Err(ErrorCode::ProtocolError),
    }
}

#[derive(Debug)]
enum Value {
    Object(BTreeMap<String, Value>),
    Array(Vec<Value>),
    String(String),
    Number(u32),
    Other,
}
impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Strict;
        impl<'de> Visitor<'de> for Strict {
            type Value = Value;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("strict unsigned-integer JSON")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Value, M::Error> {
                let mut fields = BTreeMap::new();
                while let Some(key) = map.next_key::<String>()? {
                    if fields.contains_key(&key) {
                        return Err(de::Error::custom("duplicate key"));
                    }
                    fields.insert(key, map.next_value()?);
                }
                Ok(Value::Object(fields))
            }
            fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Value, S::Error> {
                let mut values = Vec::new();
                while let Some(value) = seq.next_element()? {
                    values.push(value);
                }
                Ok(Value::Array(values))
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
                Ok(Value::String(value.to_owned()))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
                u32::try_from(value)
                    .map(Value::Number)
                    .map_err(|_| de::Error::custom("unsigned integer overflow"))
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Value, E> {
                Ok(Value::Other)
            }
            fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
                Ok(Value::Other)
            }
        }
        deserializer.deserialize_any(Strict)
    }
}
fn parse(raw: &[u8], limit: usize) -> Result<Value, ErrorCode> {
    if raw.len() > limit {
        return Err(ErrorCode::LimitExceeded);
    }
    let text = std::str::from_utf8(raw).map_err(|_| ErrorCode::InvalidInput)?;
    serde_json::from_str(text).map_err(|_| ErrorCode::InvalidInput)
}
fn object<'a>(value: &'a Value, names: &[&str]) -> Result<&'a BTreeMap<String, Value>, ErrorCode> {
    if let Value::Object(fields) = value
        && fields.len() == names.len()
        && names.iter().all(|n| fields.contains_key(*n))
    {
        return Ok(fields);
    }
    Err(ErrorCode::InvalidInput)
}
fn string(value: &Value) -> Result<&str, ErrorCode> {
    if let Value::String(s) = value {
        Ok(s)
    } else {
        Err(ErrorCode::InvalidInput)
    }
}
fn array(value: &Value) -> Result<&[Value], ErrorCode> {
    if let Value::Array(a) = value {
        Ok(a)
    } else {
        Err(ErrorCode::InvalidInput)
    }
}
fn number(value: &Value) -> Result<u32, ErrorCode> {
    if let Value::Number(n) = value {
        Ok(*n)
    } else {
        Err(ErrorCode::InvalidInput)
    }
}
