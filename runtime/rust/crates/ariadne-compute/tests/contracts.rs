use ariadne_compute::{cochange::*, protocol::*};
use serde_json::Value;
use std::path::PathBuf;
fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../contracts/compute/v1/fixtures")
            .join(name),
    )
    .unwrap()
}
#[test]
fn shared_raw_contract_fixtures_and_literal_counts() {
    let cases: Value = serde_json::from_slice(&fixture("cases.json")).unwrap();
    for case in cases["valid"].as_array().unwrap() {
        let request = decode_request(&fixture(case["request"].as_str().unwrap())).unwrap();
        let canonical = canonical_payload(&request.input).unwrap();
        assert_eq!(
            canonical,
            fixture(case["canonicalPayload"].as_str().unwrap())
        );
        assert_eq!(request.input_digest, case["sha256"].as_str().unwrap());
        let response =
            decode_response(&fixture(case["response"].as_str().unwrap()), &request).unwrap();
        let counts = count_reference(&request.input).unwrap();
        assert_eq!(response, Response::Ok(counts));
        assert_eq!(
            decode_request(&encode_request(&request).unwrap()).unwrap(),
            request
        );
        assert_eq!(
            decode_response(&encode_response(&request, &response).unwrap(), &request).unwrap(),
            response
        );
    }
    let expected = decode_request(&fixture("tiny-request.json")).unwrap();
    assert_eq!(
        decode_request(&fixture(cases["equivalentRequest"].as_str().unwrap())).unwrap(),
        expected
    );
    for case in cases["invalidRequests"].as_array().unwrap() {
        let error = decode_request(&fixture(case["file"].as_str().unwrap())).unwrap_err();
        assert_eq!(
            error.as_str(),
            case["expectedCode"].as_str().unwrap(),
            "request {}",
            case["name"]
        );
    }
    for case in cases["invalidResponses"].as_array().unwrap() {
        let error =
            decode_response(&fixture(case["file"].as_str().unwrap()), &expected).unwrap_err();
        assert_eq!(
            error.as_str(),
            case["expectedCode"].as_str().unwrap(),
            "response {}",
            case["name"]
        );
    }
    for name in cases["errorResponses"].as_array().unwrap() {
        let response = decode_response(&fixture(name.as_str().unwrap()), &expected).unwrap();
        assert!(matches!(response, Response::Error(_)));
        assert_eq!(
            decode_response(&encode_response(&expected, &response).unwrap(), &expected).unwrap(),
            response
        );
    }
}
#[test]
fn strict_wire_operation_exists() {
    let request = decode_request(&fixture("tiny-request.json"));
    assert!(request.is_ok(), "valid count request rejected: {request:?}");
}
#[test]
fn domain_empty_invalid_and_maximum_pairs() {
    let empty = count_reference(&CoChangeInput {
        file_count: 0,
        commits: vec![],
    })
    .unwrap();
    assert_eq!(
        empty,
        CoChangeCounts {
            frequencies: vec![],
            pairs: vec![]
        }
    );
    for input in [
        CoChangeInput {
            file_count: 2,
            commits: vec![vec![1, 0]],
        },
        CoChangeInput {
            file_count: 2,
            commits: vec![vec![0, 0]],
        },
        CoChangeInput {
            file_count: 2,
            commits: vec![vec![2]],
        },
    ] {
        assert_eq!(count_reference(&input), Err(CountError::InvalidInput));
    }
    let input = CoChangeInput {
        file_count: MAX_FILES,
        commits: (0..MAX_COMMITS)
            .map(|i| {
                (0..MAX_FILES_PER_COMMIT)
                    .map(|j| (i * MAX_FILES_PER_COMMIT + j) as u32)
                    .collect()
            })
            .collect(),
    };
    let mut counts = count_reference(&input).unwrap();
    assert_eq!(counts.pairs.len(), MAX_PAIRS);
    assert!(counts.frequencies.iter().all(|f| *f == 1));
    assert!(counts.pairs.iter().all(|p| p.count == 1));
    validate_counts(&input, &counts).unwrap();
    counts.pairs.push(PairCount {
        a: 0,
        b: 1,
        count: 1,
        first_seen_ordinal: 0,
    });
    assert_eq!(
        validate_counts(&input, &counts),
        Err(CountError::LimitExceeded)
    );
}
#[test]
fn bounds_precede_parsing_and_expected_request_is_required() {
    assert_eq!(
        decode_request(&vec![b' '; MAX_REQUEST_BYTES + 1]),
        Err(ErrorCode::LimitExceeded)
    );
    let expected = new_request(
        "limit",
        CoChangeInput {
            file_count: 0,
            commits: vec![],
        },
    )
    .unwrap();
    assert_eq!(
        decode_response(&vec![b' '; MAX_RESPONSE_BYTES + 1], &expected),
        Err(ErrorCode::LimitExceeded)
    );
    let invalid = Request {
        request_id: String::new(),
        ..expected.clone()
    };
    assert!(decode_response(&fixture("tiny-response.json"), &invalid).is_err());
    for input in [
        CoChangeInput {
            file_count: MAX_FILES + 1,
            commits: vec![],
        },
        CoChangeInput {
            file_count: 0,
            commits: vec![vec![]; MAX_COMMITS + 1],
        },
        CoChangeInput {
            file_count: 26,
            commits: vec![vec![0; 26]],
        },
    ] {
        assert_eq!(new_request("limit", input), Err(ErrorCode::LimitExceeded));
    }
    for payload in [
        serde_json::json!({"fileCount":37501,"commits":[]}),
        serde_json::json!({"fileCount":0,"commits":vec![Vec::<u32>::new();MAX_COMMITS+1]}),
        serde_json::json!({"fileCount":26,"commits":[(0..26).collect::<Vec<u32>>() ]}),
    ] {
        let raw=serde_json::to_vec(&serde_json::json!({"protocol":PROTOCOL,"operation":OPERATION,"requestId":"limit","inputDigest":expected.input_digest,"payload":payload})).unwrap();
        assert_eq!(decode_request(&raw), Err(ErrorCode::LimitExceeded));
    }
}

#[test]
fn correlated_payload_errors_preserve_validated_envelope_without_reparse() {
    use ariadne_compute::protocol::{decode_request_correlated, encode_error};
    let raw = include_bytes!("../../../../../contracts/compute/v1/fixtures/tiny-request.json");
    let original = String::from_utf8(raw.to_vec()).unwrap();
    for payload in [
        "{\"fileCount\":3,\"fileCount\":3,\"commits\":[]}",
        "{\"fileCount\":-0,\"commits\":[]}",
        "{\"fileCount\":3,\"commits\":[[3]]}",
    ] {
        let mut value: serde_json::Value = serde_json::from_str(&original).unwrap();
        value.as_object_mut().unwrap().remove("payload");
        let envelope = serde_json::to_string(&value).unwrap();
        // Payload before correlation fields must not lose a validated correlation.
        let broken = format!("{{\"payload\":{payload},{}", &envelope[1..]);
        let failure = decode_request_correlated(broken.as_bytes()).unwrap_err();
        assert_eq!(
            failure.code,
            ariadne_compute::protocol::ErrorCode::InvalidInput
        );
        assert!(failure.correlation.is_some(), "{broken}");
        let encoded = encode_error(&failure.correlation.unwrap(), failure.code).unwrap();
        assert!(
            String::from_utf8(encoded)
                .unwrap()
                .contains("INVALID_INPUT")
        );
    }
}

#[test]
fn pure_kernel_cancels_during_commits_and_pair_materialization() {
    use ariadne_compute::cochange::{CoChangeInput, CountError, count_cancellable};
    let input = CoChangeInput {
        file_count: 3,
        commits: vec![vec![0, 1, 2]],
    };
    for cancel_at in [2, input.commits.len() + 2] {
        let mut checkpoints = 0;
        assert_eq!(
            count_cancellable(&input, || {
                checkpoints += 1;
                checkpoints >= cancel_at
            }),
            Err(CountError::Cancelled)
        );
        assert_eq!(checkpoints, cancel_at);
    }
}

#[test]
fn missing_payload_is_an_unreadable_envelope() {
    let failure=ariadne_compute::protocol::decode_request_correlated(br#"{"protocol":"ariadne.compute/1","operation":"cochange-counts/1","requestId":"tiny","inputDigest":"73c33205d9b30fdfdf31e08236aaf51c309f31ebab0c6e98910f013f94e732d6"}"#).unwrap_err();
    assert_eq!(failure.code, ErrorCode::InvalidInput);
    assert!(
        failure.correlation.is_none(),
        "missing required envelope field must not get an error frame"
    );
}
#[test]
fn strict_payload_lexical_errors_precede_unsupported_version_even_without_correlation() {
    for payload in [
        r#"{"fileCount":-0,"commits":[]}"#,
        r#"{"fileCount":0,"fileCount":0,"commits":[]}"#,
    ] {
        let raw = format!(
            r#"{{"protocol":"future","operation":"cochange-counts/1","requestId":"!","inputDigest":"73c33205d9b30fdfdf31e08236aaf51c309f31ebab0c6e98910f013f94e732d6","payload":{payload}}}"#
        );
        let failure =
            ariadne_compute::protocol::decode_request_correlated(raw.as_bytes()).unwrap_err();
        assert_eq!(failure.code, ErrorCode::InvalidInput);
        assert!(failure.correlation.is_none());
    }
}
