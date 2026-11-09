use ariadne_extension_worker::domain::WORLD;
use wit_parser::{FunctionKind, Resolve, Type, TypeDefKind, WorldItem};

const CONTRACT: &str = include_str!("../../../contracts/extensions/v1/report-projector.wit");

fn byte_list(resolve: &Resolve, ty: Type) -> bool {
    matches!(ty, Type::Id(id) if matches!(resolve.types[id].kind, TypeDefKind::List(Type::U8)))
}

fn matches_worker_contract(source: &str) -> bool {
    let mut resolve = Resolve::default();
    let Ok(package) = resolve.push_str("report-projector.wit", source) else {
        return false;
    };
    let Ok(world_id) = resolve.select_world(package, None) else {
        return false;
    };
    let world = &resolve.worlds[world_id];
    if resolve.packages[package].name.interface_id(&world.name) != WORLD
        || !world.imports.is_empty()
        || world.exports.len() != 1
    {
        return false;
    }
    let Some(WorldItem::Function(function)) = world.exports.values().next() else {
        return false;
    };
    if function.name != "project" || function.kind != FunctionKind::Freestanding {
        return false;
    }
    let [(name, input)] = function.params.as_slice() else {
        return false;
    };
    let Some(Type::Id(result_id)) = function.result else {
        return false;
    };
    let TypeDefKind::Result(result) = &resolve.types[result_id].kind else {
        return false;
    };
    name == "input"
        && byte_list(&resolve, *input)
        && result.ok.is_some_and(|ty| byte_list(&resolve, ty))
        && result.err == Some(Type::String)
}

#[test]
fn published_wit_is_valid_and_matches_the_worker() {
    assert!(matches_worker_contract(CONTRACT));
}

#[test]
fn gate_rejects_invalid_wit_or_drift_from_the_worker_contract() {
    for source in [
        "invalid wit".to_owned(),
        CONTRACT.replace("1.0.0", "2.0.0"),
        CONTRACT.replace("report-projector", "different-world"),
        CONTRACT.replace("export project", "export different"),
        CONTRACT.replace("input: list<u8>", "input: list<u16>"),
        CONTRACT.replace("result<list<u8>, string>", "result<list<u16>, string>"),
        CONTRACT.replace("result<list<u8>, string>", "result<list<u8>, list<u8>>"),
        CONTRACT.replace("export project", "import clock: func(); export project"),
        CONTRACT.replace("export project", "export extra: func(); export project"),
    ] {
        assert!(
            !matches_worker_contract(&source),
            "accepted incompatible WIT: {source}"
        );
    }
}
