# Selectable modules and ontology architecture

Ariadne has one entry point and independent capability boundaries. Select the
dependencies needed for a task; each module keeps ownership of its data and rules.
This boundary supports coding, research, documentation and other agent tasks.

```sh
npm run setup -- --modules ontology
npm run verify -- --modules ontology
npm run setup -- --modules memory,ontology
npm run verify -- --modules memory,ontology
```

`setup`, `build`, `test` and `verify` accept `--modules name,name` or
`--modules=name,name`. Core is always included. Omit the option for the complete
product. Unknown, empty or duplicate selections fail before an action runs.
Selection applies to that invocation; it is not an activation profile or an
uninstaller. All source remains in the checkout. Only selected memory/code
dependencies are installed and built. No module changes global credentials.

| Boundary | Owns | Runtime requirements |
| --- | --- | --- |
| Core | Requirements, context budgets, shared file safety and launch coordination | Node.js |
| Memory | Durable memory, organization authorization, retrieval and its database schema | Its locked dependencies, PostgreSQL and configured vector backend |
| Code | Code graph, impact analysis and local facts | Its locked dependencies and local SQLite data |
| Ontology | Authored vocabulary, explicit relations, provenance and review freshness | Node.js and explicitly selected local files |

Ontology can run without the memory or code package. Memory does not need
ontology to operate. Their source and storage formats remain independent.
`knowledge promote|index` retains the existing wiki snapshot workflow; it does not
silently infer typed ontology assertions from links.

## DDD and clean architecture

Domain-driven design (DDD) separates concepts with different rules and ownership.
Here memory, code and ontology are bounded contexts: a module cannot import another
context's internal implementation or write its storage. The root launcher connects
their public commands. Existing memory HTTP/MCP and code MCP contracts remain
owned by those packages; this change does not add a new network API.

Within ontology, the versioned definition is the aggregate: term IDs are unique,
relations must refer to terms in that definition, and duplicate edges are invalid.
A source path plus content hash records provenance. A review digest refers to the
complete definition and its observed sources. It is a local assertion of review,
not authentication, approval authority or proof of factual correctness.

| Layer | Owner | Allowed dependencies |
| --- | --- | --- |
| Domain | `modules/ontology/domain.mjs` | Pure vocabulary validation, lexical matching and review-state rules; shared pure secret detection |
| Application | `modules/ontology/application.mjs` | Domain rules and injected document-read, source-hash and hashing functions |
| File adapter | `modules/ontology/files.mjs` | Implements those functions with bounded local reads and SHA-256 |
| CLI composition | `modules/ontology/cli.mjs` | Parses arguments, connects the adapter to the application and scrubs output |

The domain and application do not import filesystem, process, database or CLI
code. Tests can exercise the use cases through in-memory ports, while integration
tests use real temporary files. A later adapter can supply the same input contract
without changing vocabulary rules; adding one still requires its own permission,
failure and resource contracts.

The bounded file implementation lives in `core/infrastructure/project-files.mjs`;
`lib/project-files.mjs` preserves the public entrypoint. The existing
loop file entry point re-exports only its original scrubbed-read, list and guarded
write functions. Raw text is consumed inside the ontology file adapter and is not
exposed as a loop tool. Moving this shared infrastructure does not activate the
paused dispatcher or automatic execution runtime.

The whole-product [architecture reference](architecture.md) owns context and layer
boundaries, ownership maps, compatibility paths, and validation scope. Its root
checks cover requirements, context packs, rules integration, wiki, execution
foundations, ontology, product coordination, evaluation, and package production
tools. Selected packages also run their AST boundary checks.

## Local ontology workflow

```sh
node bin/Ariadne.mjs ontology inspect --file modules/ontology/example.json
node bin/Ariadne.mjs ontology search --file modules/ontology/example.json --query memory --limit 5
```

Use an absolute Ariadne launcher path when running from another directory. Relative
`--file` values resolve from the caller's directory; source paths resolve from the
definition's directory. Put a project ontology at its root to reference `docs/...`.

The [example definition](../modules/ontology/example.json) has this contract:

```json
{
  "schema_version": 1,
  "terms": [
    {
      "id": "memory",
      "name": "Memory",
      "description": "Reusable knowledge with its source and scope.",
      "synonyms": ["기억"],
      "sources": ["docs/memory.md"]
    }
  ],
  "relations": []
}
```

Omit `reviewed_digest` until review, then add the 64-character lowercase digest
returned by `inspect` as its value.
Each relation has `from`, `type`, `to` and `sources`. IDs and relation types use
lowercase ASCII letters/digits, dots, underscores or hyphens, beginning with a
letter/digit and limited to 64 characters. Names and synonyms may use any language.
Unknown fields and invalid references fail rather than being silently ignored.

1. Author terms, synonyms, relations and their source paths. Empty source arrays
   are allowed but mean an authored assertion without linked evidence.
2. Run `inspect`. Review the definition and the referenced source files yourself.
3. Record its `digest` as `reviewed_digest` only after that review. Run `inspect`
   again; it reports `current` only if the same definition and source bytes remain.
4. Run `search` when assembling task context. Check `review_status`, `ambiguous`
   and truncation before using the results.

| Review status | Meaning at the time of the read |
| --- | --- |
| `unreviewed` | No digest was recorded |
| `current` | The recorded digest matches the observed definition and sources |
| `stale` | A definition or source change invalidated the recorded digest |

The fingerprint includes a version, validated definitions without the recorded
digest, and sorted source-path/hash pairs. JSON whitespace and object key order
do not change it; array order and every source byte do. Every command rereads the
explicit sources. There is no second canonical database, generated cache or stored
ready flag. Missing/unreadable sources fail the command. The definition cannot
reference itself, including a detected hardlink alias.

Search normalizes Unicode with NFKC and lowercase, then matches the complete query
as a substring. Exact IDs/names/synonyms rank first, partial labels next, descriptions
last; ties use ID order. Shared exact labels remain ambiguous even if the limit
hides another candidate. It does not perform embeddings, natural-language
question answering, source-text extraction or transitive reasoning.

`--limit` defaults to 5 and accepts 1–20. It caps matching terms and incident
relations separately; counts and truncation flags describe omitted results.
Relations may reference terms outside the matching list. Only referenced source
paths and hashes are returned, never source bodies. Matching vocabulary does not
establish that a question is answerable. No token savings or model-quality result
has been measured for this feature.

The manifest and each UTF-8 source are limited to 1 MiB, with at most 32 unique
sources, 1,000 terms and 5,000 relations. Each term has at most 10 synonyms; names
and synonyms are limited to 200 characters and descriptions to 2,000. Query length
is limited to 256. These are character/row limits, not a tokenizer budget.
Traversal, protected paths and symlinks are rejected by the shared reader.
Secret-shaped structural IDs/paths are rejected; display text is scrubbed before
JSON encoding. Work in a trusted, stable workspace: these reads are not an atomic
multi-file snapshot or an OS sandbox against concurrent hostile filesystem writers.

## What was taken from NVIDIA auto-ontology

The review is pinned to commit
[`caced11e`](https://github.com/NVIDIA/auto-ontology/tree/caced11e69e19663dfa0f73778dbecbcb71e87a0).
Ariadne independently implements a smaller local vocabulary workflow; NVIDIA
source code, dependencies and services are not vendored.

| Upstream concept | Ariadne decision |
| --- | --- |
| Terms, synonyms and explicit relationships | Adopt as authored domain definitions, with stable IDs and validated references |
| Human certification | Adapt to a digest bound to definitions and source bytes; no automatic certification |
| Answerability coverage | Keep lexical match counts and ambiguity; do not present them as answerability |
| Schema ingestion, SQL attributes and SQL execution | Defer: they require database authorization and execution contracts beyond this module |
| MCP and model-provider orchestration | Preserve existing Ariadne module contracts; do not add another service or provider configuration |
| Model interchange/export | Defer until a lossless contract for provenance and review exists |

Upstream term updates can retain certification flags after changing text
([implementation](https://github.com/NVIDIA/auto-ontology/blob/caced11e69e19663dfa0f73778dbecbcb71e87a0/auto_ontology/dal/terms.py#L365-L373)).
Its coverage calculation counts retrieved entity matches
([implementation](https://github.com/NVIDIA/auto-ontology/blob/caced11e69e19663dfa0f73778dbecbcb71e87a0/auto_ontology/retrieval/entity_coverage/agents/coverage.py#L60-L66)).
These findings motivate revision-bound review and narrower result claims here.
Any future code import must separately preserve its upstream license and notices.

## Choices and verification

A persisted module profile and Markdown compiler were considered. They would add
installation-state recovery, parsing conventions and generated-state invalidation.
Explicit selection and an authored JSON aggregate satisfy the present requirement
with fewer states to keep consistent. Whole-definition review is deliberately
coarse: one change invalidates the review, trading review convenience for a clear
rule. Per-assertion review can be added if real usage justifies that complexity.

The source-only gate runs core and bundled ontology tests without memory/code
dependencies. Selected package verification adds that package's canonical gates;
selecting code also adds the root code integration. Default `npm run verify`
retains the complete local product gate. PostgreSQL/pgvector, transformer and
cross-module MCP checks still belong to their dedicated CI jobs and require their
explicit disposable environment. Local source/package tests do not establish
those integration outcomes.
