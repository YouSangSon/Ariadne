use syn::visit::{self, Visit};

struct Boundaries<'a> {
    layer: &'a str,
    errors: Vec<String>,
}

impl Boundaries<'_> {
    fn check(&mut self, parts: &[String]) {
        let path = parts.join("::");
        let std_module = match parts {
            [root, module, ..] if root == "std" => Some(module.as_str()),
            _ => None,
        };
        let forbidden = parts.first().is_some_and(|p| p == "wasmtime_wasi")
            || (self.layer != "main" && std_module == Some("process"))
            || (self.layer == "domain"
                && std_module.is_some_and(|module| {
                    ["fs", "net", "process", "env", "io", "thread", "time"].contains(&module)
                }))
            || (self.layer == "protocol"
                && std_module.is_some_and(|module| ["fs", "net", "env"].contains(&module)))
            || (self.layer == "engine"
                && parts.last().is_some_and(|p| {
                    [
                        "deserialize",
                        "deserialize_file",
                        "from_file",
                        "from_trusted_file",
                    ]
                    .contains(&p.as_str())
                }))
            || (self.layer == "domain"
                && parts.first().is_some_and(|p| {
                    ["wasmtime", "serde", "serde_json", "sha2"].contains(&p.as_str())
                        || (parts.len() > 1
                            && !["std", "core", "alloc", "self", "super"].contains(&p.as_str()))
                }))
            || (self.layer == "engine"
                && (path.starts_with("std::fs")
                    || path.starts_with("std::net")
                    || path.starts_with("std::process")
                    || path.starts_with("crate::protocol")))
            || (self.layer == "protocol"
                && (path.starts_with("wasmtime") || path.starts_with("crate::engine")));
        if forbidden {
            self.errors.push(path);
        }
    }
    fn use_tree(&mut self, tree: &syn::UseTree, prefix: Vec<String>) {
        match tree {
            syn::UseTree::Path(path) => {
                let mut prefix = prefix;
                prefix.push(path.ident.to_string());
                self.use_tree(&path.tree, prefix);
            }
            syn::UseTree::Group(group) => {
                for item in &group.items {
                    self.use_tree(item, prefix.clone());
                }
            }
            syn::UseTree::Name(name) => {
                let mut prefix = prefix;
                prefix.push(name.ident.to_string());
                self.check(&prefix);
            }
            syn::UseTree::Rename(rename) => {
                let mut prefix = prefix;
                prefix.push(rename.ident.to_string());
                self.check(&prefix);
            }
            syn::UseTree::Glob(_) => self.check(&prefix),
        }
    }
}

impl<'ast> Visit<'ast> for Boundaries<'_> {
    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        self.use_tree(&item.tree, Vec::new());
    }
    fn visit_path(&mut self, path: &'ast syn::Path) {
        self.check(
            &path
                .segments
                .iter()
                .map(|p| p.ident.to_string())
                .collect::<Vec<_>>(),
        );
        visit::visit_path(self, path);
    }
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if self.layer == "engine"
            && [
                "deserialize",
                "deserialize_file",
                "from_file",
                "from_trusted_file",
            ]
            .contains(&call.method.to_string().as_str())
        {
            self.errors.push(call.method.to_string());
        }
        visit::visit_expr_method_call(self, call);
    }
}

#[test]
fn rust_layers_have_owned_sources_and_inward_dependencies() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for entry in std::fs::read_dir(root.join("src")).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_str().unwrap().to_owned();
        assert!(
            ["lib.rs", "domain.rs", "engine.rs", "protocol.rs", "main.rs"].contains(&name.as_str()),
            "unowned Rust source {name}"
        );
        let source = std::fs::read_to_string(entry.path()).unwrap();
        let syntax = syn::parse_file(&source).unwrap();
        let mut checker = Boundaries {
            layer: name.trim_end_matches(".rs"),
            errors: Vec::new(),
        };
        checker.visit_file(&syntax);
        assert!(checker.errors.is_empty(), "{name}: {:?}", checker.errors);
    }
}

#[test]
fn gate_rejects_grouped_aliases_and_outward_imports() {
    for (layer, source) in [
        ("engine", "use std::{net::TcpStream as Socket};"),
        ("domain", "use wasmtime::Engine;"),
        ("protocol", "use crate::engine::Executor;"),
        ("main", "use wasmtime_wasi::WasiCtx;"),
        (
            "engine",
            "fn load() { let _ = unsafe { Component::deserialize(&engine, bytes) }; }",
        ),
        (
            "engine",
            "fn load() { let _ = Component::from_file(&engine, path); }",
        ),
    ] {
        let mut checker = Boundaries {
            layer,
            errors: Vec::new(),
        };
        checker.visit_file(&syn::parse_file(source).unwrap());
        assert!(!checker.errors.is_empty());
    }
}

#[test]
fn gate_rejects_os_io_in_domain_and_protocol() {
    for (layer, modules) in [
        (
            "domain",
            &["fs", "net", "process", "env", "io", "thread", "time"][..],
        ),
        ("protocol", &["fs", "net", "process", "env"][..]),
        ("lib", &["process"][..]),
    ] {
        for module in modules {
            for source in [
                format!("use std::{module}::Resource;"),
                format!("use std::{{{module}}};"),
                format!("use std::{{{module} as alias}};"),
                format!("fn operation() {{ std::{module}::operation(); }}"),
            ] {
                let mut checker = Boundaries {
                    layer,
                    errors: Vec::new(),
                };
                checker.visit_file(&syn::parse_file(&source).unwrap());
                assert!(!checker.errors.is_empty(), "{layer} accepted {source}");
            }
        }
    }
}

#[test]
fn gate_allows_pure_values_protocol_stdio_and_composition_processes() {
    for (layer, source) in [
        (
            "domain",
            "use std::collections::BTreeMap; use core::option::Option; use alloc::vec::Vec;",
        ),
        ("protocol", "use std::io::{Read, Write};"),
        ("main", "fn finish() { std::process::exit(1); }"),
    ] {
        let mut checker = Boundaries {
            layer,
            errors: Vec::new(),
        };
        checker.visit_file(&syn::parse_file(source).unwrap());
        assert!(checker.errors.is_empty(), "{layer}: {:?}", checker.errors);
    }
}
