---
description: Agent guide for @rusl-labs/zodforge — schema-driven codegen with Rusl and Bun.
globs: "*.ts, *.tsx, *.json, package.json"
alwaysApply: false
---

IRON RULE: Before creating, modifying, or generating code for any data type, you must read [SCHEMA.md](SCHEMA.md) first.

# @rusl-labs/zodforge — agent guide

This repo builds **zodforge** — a CLI that generates Zod modules from JSON Schema. It also **dogfoods Rusl**: vendored shapes live in `schemas/`, generated Zod in `src/schemas/`.

## Quick rules

- **Never** hand-write `z.object()` or TypeScript interfaces for Rusl-managed shapes.
- **Never** edit vendored `schemas/`, `rusl.lock`, or generated `src/schemas/` by hand.
- **`rusl.bundle.toml`** is the schema deps manifest — use `rusl add` / `rusl remove`, or edit constraints then `rusl install`.
- **Tooling changes** go in `src/` directly.
- **Run** `bun run schemas:verify` after schema dependency or codegen changes.

## Commands

| Task | Command |
|------|---------|
| Install JS deps | `bun install` |
| Build CLI/lib | `bun run build` |
| Test | `bun test` |
| Sync Rusl + regenerate Zod | `bun run schemas:sync` |
| Generate Zod from vendored schemas | `bun run schemas:generate` |
| Verify derived output is fresh | `bun run schemas:verify` |
| Clean zodforge output | `bun run schemas:clean` |

## Layout

```
rusl.bundle.toml   ← schema deps (like package.json)
rusl.lock          ← pins from rusl install — do not edit
schemas/           ← vendored JSON Schema — do not edit
src/schemas/       ← zodforge output — do not edit
src/               ← zodforge library + CLI
test/fixtures/     ← test-only schema fixtures (not Rusl)
```

## When schemas change

1. `rusl search` → `rusl add …` (or edit `rusl.bundle.toml`)
2. `bun run schemas:sync`
3. `bun run schemas:verify`

Rusl MCP, CLI reference, and shape vs meaning — see [SCHEMA.md](SCHEMA.md).

## Bun

Default to **Bun** instead of Node.js, npm, pnpm, or vite in this repo.

- `bun install` — not `npm install`, `yarn`, or `pnpm install`
- `bun run <script>` — not `npm run`
- `bun test` — not jest or vitest
- `bunx <package> <command>` — not npx

Bun loads `.env` automatically — don't add dotenv. Prefer `Bun.file` over `node:fs` read/write when using Bun APIs directly.

Build uses **tsup** (`bun run build`); tests use **bun:test**. See [Bun docs](https://bun.sh/docs) or `node_modules/bun-types/docs/**.mdx` for API details.
