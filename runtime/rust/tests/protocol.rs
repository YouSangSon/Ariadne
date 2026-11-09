use ariadne_extension_worker::protocol::{Request, read_frame};
use std::io::Cursor;

#[test]
fn frame_lengths_are_bounded_before_allocation() {
    assert!(read_frame(&mut Cursor::new(u32::MAX.to_be_bytes()), 1024).is_err());
    assert!(read_frame(&mut Cursor::new([0, 0, 0, 2, 1]), 1024).is_err());
    assert_eq!(
        read_frame(&mut Cursor::new([0, 0, 0, 2, 1, 2]), 2).unwrap(),
        [1, 2]
    );
}

#[test]
fn duplicate_and_unknown_envelope_fields_are_rejected() {
    for json in [r#"{"protocol":"a","protocol":"b"}"#, r#"{"unknown":true}"#] {
        assert!(Request::parse(json.as_bytes()).is_err());
    }
}

#[test]
fn exact_input_and_artifact_bytes_are_bound_to_fixed_profile() {
    use ariadne_extension_worker::{domain::*, protocol::*};
    let wasm = b"raw component bytes";
    let request = Request {
        protocol: PROTOCOL.into(),
        invocation_id: "id-1".into(),
        package_digest: "0".repeat(64),
        input_digest: sha256(b"{}"),
        artifact_digest: sha256(wasm),
        world: WORLD.into(),
        profile_revision: PROFILE.into(),
        input: "{}".into(),
    };
    let json = serde_json::to_vec(&request).unwrap();
    let parsed = Request::parse(&json).unwrap();
    assert!(parsed.verify_artifact(wasm));
    assert!(!parsed.verify_artifact(b"tampered"));
    for (field, value) in [
        ("input", "{ }"),
        ("world", "other"),
        ("profileRevision", "e0-2"),
        ("invocationId", "bad/identity"),
        ("packageDigest", "A"),
        ("unknown", "value"),
    ] {
        let mut changed: serde_json::Value = serde_json::from_slice(&json).unwrap();
        changed[field] = value.into();
        assert!(
            Request::parse(&serde_json::to_vec(&changed).unwrap()).is_err(),
            "{field}"
        );
    }
    let duplicate = format!(
        "{{\"input\":\"{{}}\",{}",
        std::str::from_utf8(&json).unwrap().trim_start_matches('{')
    );
    assert!(Request::parse(duplicate.as_bytes()).is_err());
}

#[test]
fn escaped_json_strings_keep_decoded_byte_limits() {
    use ariadne_extension_worker::{domain::*, protocol::*};
    let input = format!("{}{{}}", "\t".repeat(MAX_INPUT - 2));
    let request = Request {
        protocol: PROTOCOL.into(),
        invocation_id: "escaped".into(),
        package_digest: "0".repeat(64),
        input_digest: sha256(input.as_bytes()),
        artifact_digest: sha256(b"wasm"),
        world: WORLD.into(),
        profile_revision: PROFILE.into(),
        input,
    };
    let json = serde_json::to_vec(&request).unwrap();
    assert_eq!(Request::parse(&json).unwrap().input.len(), MAX_INPUT);
    let output = format!("{}{{}}", "\t".repeat(MAX_OUTPUT - 2));
    let outcome = Outcome::Output(output.as_bytes().to_vec());
    let response = serde_json::to_vec(&Response::new(&request, &outcome)).unwrap();
    let mut frame = Vec::new();
    ariadne_extension_worker::protocol::write_frame(&mut frame, &response, MAX_RESPONSE).unwrap();
    assert_eq!(
        read_frame(&mut Cursor::new(frame), MAX_RESPONSE).unwrap(),
        response
    );
}
