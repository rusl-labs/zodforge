# @rusl-labs/zodforge

Codegen CLI that mirrors JSON Schema paths into generated Zod modules.

Point zodforge at a directory of `.json` schema files — no other tooling required.

## Quick start

Put JSON Schema files in `./schemas/`, then run:

```sh
bunx @rusl-labs/zodforge generate
# npx @rusl-labs/zodforge generate
```

Defaults: `./schemas/**/*.json` → `./src/schemas/`. No install or build step required.

Import the generated modules in your app (requires `zod` in your project):

```ts
import { profileSchema, type Profile } from "./src/schemas/user/profile";
```

For repeated use, add it as a dev dependency:

```sh
npm i -D @rusl-labs/zodforge zod
```

Then `npx zodforge generate`, `npx zodforge clean`, etc.

## How it works

```
schemas/**/*.json            ← your JSON Schema files
        │
        ▼  zodforge generate
src/schemas/**/*.ts          ← generated (do not edit)
        │
        ▼  import
your app
```

| Command | Purpose |
|---------|---------|
| `bunx @rusl-labs/zodforge generate` | Derive Zod modules from JSON Schema |
| `bunx @rusl-labs/zodforge clean` | Remove generated output |
| `verifyGeneratedSchemas()` | Fail if derived output is stale (API — see below) |

---

## Using in your app

zodforge is **codegen-only**. Your application imports the generated Zod modules at runtime — it does not call zodforge on every request.

### 1. Install (optional)

Skip this for one-off runs — use `bunx` or `npx` directly (see Quick start).

To add zodforge to a project:

```sh
npm i -D @rusl-labs/zodforge zod
# bun add -d @rusl-labs/zodforge zod
# pnpm add -D @rusl-labs/zodforge zod
```

**Requirements:** Node ≥ 18, Zod ^4.3, TypeScript ^5 (peer deps).

### 2. Project layout

```
my-app/
  schemas/              # JSON Schema source files
    user/
      profile.json
  src/
    schemas/            # generated Zod modules
    app.ts
```

Put `.json` files anywhere under your schemas directory. zodforge mirrors the directory tree into the output folder.

### 3. Generate, verify, clean

```sh
# Defaults: glob ./schemas/**/*.json → output ./src/schemas
bunx @rusl-labs/zodforge generate

# Custom paths
bunx @rusl-labs/zodforge generate --path ./contracts/**/*.json -o ./src/schemas --schemas-dir ./contracts

# Remove generated files
bunx @rusl-labs/zodforge clean
```

Recommended `package.json` scripts:

```json
{
  "scripts": {
    "schemas:generate": "zodforge generate",
    "schemas:clean": "zodforge clean"
  }
}
```

Run **`zodforge generate`** whenever schema files change. `generate` **wipes the output directory first**, so removed schemas disappear from generated output automatically.

**Verify** (check output is up to date):

```ts
import { verifyGeneratedSchemas } from "@rusl-labs/zodforge";

const result = await verifyGeneratedSchemas();
if (!result.ok) {
  console.error("Stale:", result.stale);
  process.exit(1);
}
```

### 4. TypeScript config

Generated modules import JSON from your schemas directory:

```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*.ts", "schemas/**/*.json"]
}
```

### 5. Import in application code

Each schema file exports a Zod schema, inferred types, and input types:

```ts
// Direct import — best for IDE navigation
import { profileSchema, type Profile } from "./schemas/user/profile";

const parsed = profileSchema.parse({ /* … */ });

// Barrel import from a directory
import { profileSchema } from "./schemas/user";

// Root barrel + lookup registry
import { profileSchema, getSchemaByIdentifier } from "./schemas";

const byPath = getSchemaByIdentifier("user/profile");
const byId = getSchemaByIdentifier("https://example.com/schemas/user/profile");
```

Generated files use `z.fromJSONSchema(json).meta({ id, title, description, pathId })`.

### 6. What gets generated

For each `schemas/foo/bar.json`, zodforge writes a mirrored module:

```
schemas/user/profile.json  →  src/schemas/user/profile.ts
```

Plus:

- `index.ts` barrel in each directory
- `_lookup.ts` at the output root with `byPath`, `byId`, and `getSchemaByIdentifier()`
- `.zodforge-manifest.json` (used by `zodforge clean`)

Naming: `profile.json` → `profileSchema`, types `Profile` and `ProfileInput`.

### 7. CLI reference

```sh
zodforge generate [options]
zodforge clean [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <glob>` | `./schemas/**/*.json` | Schema files to compile |
| `-o, --output-dir <dir>` | `./src/schemas` | Generated output directory |
| `--schemas-dir <dir>` | `./schemas` | Root for resolving JSON imports |
| `--path-prefix <prefix>` | — | Strip prefix from `pathId` values |
| `--cwd <dir>` | `process.cwd()` | Working directory |

`zodforge clean` removes files listed in `.zodforge-manifest.json`. `generate` always does a full wipe of the output dir before writing.

### 8. Commit or gitignore?

Two valid approaches:

- **Gitignore `src/schemas/`** — regenerate in CI and locally after schema changes.
- **Commit generated output** — consumers get Zod modules without running codegen.

Either way, treat generated files as derived — never edit them by hand.

### 9. Programmatic API

For tests, CI verify steps, or custom tooling:

```ts
import {
  generateSchemas,
  verifyGeneratedSchemas,
  forgeSchemas,
  cleanGeneratedSchemas,
} from "@rusl-labs/zodforge";

await generateSchemas({ outputDir: "./src/schemas" });

const result = await verifyGeneratedSchemas();
const { profileSchema } = forgeSchemas({ path: "./schemas/**/*.json" });
await cleanGeneratedSchemas();
```

Most apps only need the CLI and generated imports.

---

## Schema registries (optional)

If you use a schema registry or package manager (e.g. [Rusl](https://rusl.com)) to vendor JSON Schema into `schemas/`, zodforge works the same way — it only reads the files on disk. See [SCHEMA.md](SCHEMA.md) for this repo's schema-driven workflow.

## Development

Working on zodforge itself:

```sh
bun install
bun run build
bun run schemas:generate
bun test
```

## Agent setup

Agents working in this repo should read [AGENTS.md](AGENTS.md) and [SCHEMA.md](SCHEMA.md).

## License

MIT
