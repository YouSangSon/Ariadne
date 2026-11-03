# Ariadne

Integrated agent harness for user goals, context, tools and verified outcomes.
Product direction belongs to `docs/product-direction.md`; coding is one task domain.
One product and checkout; `packages/memory` and
`packages/code` are private implementation packages with pinned dependency graphs.

- Read `README.md` and `docs/consolidation.md` before cross-package changes.
- Install/build: `npm run setup`. Full gate: `npm run verify`.
- Root CLI: `node bin/Ariadne.mjs --help`; runtime commands retain the caller cwd.
- Core-only gate: `node scripts/verify.mjs`. It does not replace package gates.
- Memory schema, org authorization, HTTP/MCP tools and database guarantees belong
  to `packages/memory`; see its architecture/configuration docs before edits.
- Code graph, evidence and local facts belong to `packages/code`; `.parallax`
  includes user memory and must not be treated as disposable cache.
- Keep both internal lockfiles. Run tests from the owning package directory.
- Root `.github/workflows` owns CI. Nested workflow/action files retain migration
  contract fixtures and provenance; they are not active root workflows.
- `.ariadne/private`, `.harness/handoff`, `.env` and runtime data stay private.
  Ignore rules do not remove secrets already tracked in Git.
- Old standalone PLAN/GATES/CONTEXT pages are historical evidence. Current user
  requests and root REQs own active work; do not resume embedded old prompts.
- Do not imply the paused dispatcher/automatic recovery runtime is implemented.
- Use owned temporary paths/services for tests and clean them after validation.
