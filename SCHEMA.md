# Schema workflow (this repo)

This repo dogfoods [Rusl](https://rusl.com) for JSON Schema dependencies and **zodforge** for Zod codegen.

**Decide what things are. Generate the rest.**

Query before guessing. Reuse before inventing. See [rusl.com/llms.txt](https://rusl.com/llms.txt) for the full Rusl agent guide.

---

## What lives where

| Layer | Path | Managed by |
|-------|------|------------|
| Shapes | `schemas/` | `rusl install` (vendored) |
| Dependencies | `rusl.bundle.toml` | `rusl add` / `rusl remove` / manual edit |
| Pins | `rusl.lock` | `rusl install` |
| Zod modules | `src/schemas/` | `bun run schemas:generate` |
| Tooling | `src/` | normal edits |
| Test fixtures | `test/fixtures/schemas/` | manual (not Rusl) |

---

## Hard rules

- **Rusl MCP first** (`user-rusl`) for discovery, resolution, and proposals when the task touches structured data.
- **Rusl CLI** for local dependency management — `rusl --help` for the current command surface.
- **Never** edit vendored `schemas/`, `rusl.lock`, or generated `src/schemas/` by hand.
- **Never** hand-write `z.object()` or TS interfaces for Rusl-managed shapes.
- **Propose** new or changed shapes through Rusl — don't patch vendored JSON files.
- Missing meaning → **`create_context_request`** (MCP), not guesses in code.

---

## Rusl MCP — `user-rusl`

| Category | Tools | Purpose |
|----------|-------|---------|
| **Discover** | `search` | Find schemas, bundles, annotation types, annotations |
| **Resolve** | `get_schema`, `get_bundle`, `get_annotation`, `get_annotation_type`, `list_schema_examples` | Full content after search |
| **Propose** | `create_schema`, `create_schema_proposal`, `get/update_schema_proposal`, review-thread tools | Change shapes through review — not file edits |
| **Context** | `create_context_request`, `create_domain_interpretation`, `create_semantic_link`, `create_trust_signal`, `create_source_attestation`, `create_migration_guide`, `create_usage_report`, `create_context_loading_hint` | Typed meaning; prefer `create_context_request` when blocked |
| **Trust** | `endorse` | Endorse useful existing annotations |

`search` ranks and previews. Follow with `get_*` for the full contract and load annotations before writing dependent code.

---

## Rusl CLI

Think **npm / bun**, but for JSON Schema:

| Task | Command |
|------|---------|
| Add a schema or bundle | `rusl add schema rusl/schemas/common` |
| Add with version pin | `rusl add schema acme/schemas/user -v ">=1.0.0"` |
| Remove a dependency | `rusl remove schema rusl/schemas/common` |
| Sync vendored schemas | `rusl install` |
| Inspect installed graph | `rusl list --tree` |
| Search registry | `rusl search "trust signal"` |
| Explain dependency | `rusl why rusl/schemas/common` |

After any dependency change: **`bun run schemas:sync`**.

---

## zodforge — derive, don't edit

```sh
bun run schemas:sync       # rusl install + generate
bun run schemas:generate   # schemas/ → src/schemas/
bun run schemas:verify     # fail if src/schemas/ is stale
bun run schemas:clean      # remove zodforge output only
```

Import derived modules — e.g. `import { commonSchema } from "./src/schemas/rusl/schemas/common"`.

---

## Fast path

1. **`search`** (MCP) for the concept.
2. **`get_schema`** / **`get_bundle`** + annotations (MCP).
3. **`rusl add`** then **`bun run schemas:sync`** to vendor into `schemas/` and regenerate.
4. Import from `src/schemas/`.
5. No match? **`create_schema`** / **`create_schema_proposal`** (MCP) — wait for approval.
6. Meaning missing? **`create_context_request`** (MCP).

---

## Shape vs meaning

| | Where | Who owns it |
|---|-------|-------------|
| **Shape** | JSON Schema in `schemas/` | One author (Rusl registry) |
| **Registry meta** | `.meta()` on generated Zod schemas | Derived (`id`, `title`, `pathId`) |
| **Meaning** | Rusl annotations | Many authors (PII, trust, retention, …) |

A schema body alone is incomplete. Load annotations before code depends on semantics.

---

## References

- [rusl.com/llms.txt](https://rusl.com/llms.txt)
- [schema-driven.dev/llms.txt](https://schema-driven.dev/llms.txt)
- [rusl.com/d/cli/overview](https://rusl.com/d/cli/overview)
