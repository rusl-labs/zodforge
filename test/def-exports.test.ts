import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import {
  compileJsonSchema,
  defExportDocument,
  forgeSchemas,
  generateSchemas,
} from "../src/index.ts";

const vocab = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/vocab",
  anyOf: [{ $ref: "#/$defs/tag" }],
  $defs: {
    tag: {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: { label: { type: "string" } },
    },
    delta: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "number" },
        direction: { enum: ["up", "down"] },
      },
    },
  },
} as const;

const deltaValue = { value: 1, direction: "up" as const };
const tagValue = { label: "ok" };

const oneOfRoot = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/oneof-root",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "alpha"],
      properties: {
        kind: { const: "alpha" },
        alpha: { $ref: "#/$defs/payload" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "beta"],
      properties: {
        kind: { const: "beta" },
        beta: { type: "string" },
      },
    },
  ],
  $defs: {
    payload: {
      type: "object",
      additionalProperties: false,
      required: ["n"],
      properties: { n: { type: "number" } },
    },
  },
} as const;

const deltaShape = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/delta-shape",
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: {
    value: { type: "number" },
    direction: { enum: ["up", "down"] },
  },
} as const;

const localVocab = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/local-vocab",
  anyOf: [{ $ref: "#/$defs/tag" }],
  $defs: {
    tag: vocab.$defs.tag,
    delta: deltaShape,
  },
} as const;

const extVocab = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/ext-vocab",
  anyOf: [{ $ref: "#/$defs/tag" }],
  $defs: {
    tag: vocab.$defs.tag,
    delta: { $ref: "https://example.com/delta-shape" },
  },
} as const;

describe("defExportDocument", () => {
  test("keeps only $schema, $id, defs, and $ref", () => {
    const document = defExportDocument(vocab, "delta");
    expect(Object.keys(document).sort()).toEqual([
      "$defs",
      "$id",
      "$ref",
      "$schema",
    ]);
    expect(document.$ref).toBe("#/$defs/delta");
    expect(document.$defs).toBe(vocab.$defs);
    expect(document.anyOf).toBeUndefined();
  });

  test("uses definitions when that is the bag", () => {
    const json = {
      $id: "https://example.com/legacy",
      anyOf: [{ type: "number" }],
      definitions: {
        token: { type: "string", minLength: 2 },
      },
    };
    const document = defExportDocument(json, "token");
    expect(document.$ref).toBe("#/definitions/token");
    expect(document.definitions).toBe(json.definitions);
    expect(document.$defs).toBeUndefined();
    expect(document.anyOf).toBeUndefined();
  });
});

describe("fromJSONSchema sibling $ref vs slim def document", () => {
  test("spreading the root next to $ref rejects a valid delta", () => {
    const spread = z.fromJSONSchema({
      ...vocab,
      $ref: "#/$defs/delta",
    } as Parameters<typeof z.fromJSONSchema>[0]);
    const slim = z.fromJSONSchema(
      defExportDocument(vocab, "delta") as Parameters<
        typeof z.fromJSONSchema
      >[0],
    );

    expect(spread.safeParse(deltaValue).success).toBe(false);
    expect(slim.safeParse(deltaValue).success).toBe(true);
    expect(slim.safeParse({ value: "x" }).success).toBe(false);
  });
});

describe("forge / compileJsonSchema def path", () => {
  test("delta export accepts values that only satisfy delta", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "zodforge-forge-vocab-"));
    try {
      const schemasDir = join(tempDir, "schemas");
      await mkdir(schemasDir, { recursive: true });
      await writeFile(
        join(schemasDir, "vocab.json"),
        `${JSON.stringify(vocab, null, 2)}\n`,
      );

      const forged = await forgeSchemas({
        cwd: tempDir,
        schemasDir: "./schemas",
        path: "./schemas/**/*.json",
      });

      expect(forged.zVocabDefDelta.safeParse(deltaValue).success).toBe(true);
      expect(forged.zVocabDefDelta.safeParse({ value: "x" }).success).toBe(
        false,
      );
      expect(forged.zVocabDefTag.safeParse(tagValue).success).toBe(true);
      expect(forged.zVocab.safeParse(tagValue).success).toBe(true);
      expect(forged.zVocab.safeParse(deltaValue).success).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("compileJsonSchema of a slim def document ignores root applicators", () => {
    const delta = compileJsonSchema(defExportDocument(vocab, "delta"));
    expect(delta.safeParse(deltaValue).success).toBe(true);
    expect(delta.safeParse({ value: "x" }).success).toBe(false);
    expect(delta.safeParse(tagValue).success).toBe(false);
  });
});

describe("generated def exports do not inherit root applicators", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("vocab delta export validates on its own; root anyOf is unchanged", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zodforge-vocab-"));
    const schemasDir = join(tempDir, "schemas");
    await mkdir(schemasDir, { recursive: true });
    await writeFile(
      join(schemasDir, "vocab.json"),
      `${JSON.stringify(vocab, null, 2)}\n`,
    );

    await generateSchemas({
      cwd: tempDir,
      schemasDir: "./schemas",
      path: "./schemas/**/*.json",
      outputDir: "./src/schemas",
    });

    const source = await Bun.file(
      join(tempDir, "src/schemas/vocab.zod.ts"),
    ).text();
    expect(source).not.toContain("...vocabRaw");
    expect(source).toContain("$defs: vocabRaw.$defs");
    expect(source).toContain('$ref: "#/$defs/delta"');
    expect(source).toContain("z.fromJSONSchema");
    expect(source).not.toContain("compileJsonSchema");

    const { zVocab, zVocabDefDelta, zVocabDefTag } = await import(
      join(tempDir, "src/schemas/vocab.zod.ts")
    );

    expect(zVocabDefDelta.safeParse(deltaValue).success).toBe(true);
    expect(zVocabDefDelta.safeParse({ value: "x" }).success).toBe(false);
    expect(zVocabDefTag.safeParse(tagValue).success).toBe(true);
    expect(zVocab.safeParse(tagValue).success).toBe(true);
    expect(zVocab.safeParse(deltaValue).success).toBe(false);
  });

  test("oneOf root: a def used by only one branch validates on its own", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zodforge-oneof-"));
    const schemasDir = join(tempDir, "schemas");
    await mkdir(schemasDir, { recursive: true });
    await writeFile(
      join(schemasDir, "split.json"),
      `${JSON.stringify(oneOfRoot, null, 2)}\n`,
    );

    await generateSchemas({
      cwd: tempDir,
      schemasDir: "./schemas",
      path: "./schemas/**/*.json",
      outputDir: "./src/schemas",
    });

    const { zSplit, zSplitDefPayload } = await import(
      join(tempDir, "src/schemas/split.zod.ts")
    );

    expect(zSplitDefPayload.safeParse({ n: 1 }).success).toBe(true);
    expect(zSplitDefPayload.safeParse({ n: "x" }).success).toBe(false);
    expect(zSplitDefPayload.safeParse({ kind: "beta", beta: "x" }).success).toBe(
      false,
    );

    expect(
      zSplit.safeParse({ kind: "alpha", alpha: { n: 1 } }).success,
    ).toBe(true);
    expect(zSplit.safeParse({ kind: "beta", beta: "woof" }).success).toBe(true);
    expect(zSplit.safeParse({ n: 1 }).success).toBe(false);
  });

  test("external-$ref and local def of the same shape validate identically", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zodforge-parity-"));
    const schemasDir = join(tempDir, "schemas");
    await mkdir(schemasDir, { recursive: true });
    await writeFile(
      join(schemasDir, "delta-shape.json"),
      `${JSON.stringify(deltaShape, null, 2)}\n`,
    );
    await writeFile(
      join(schemasDir, "local-vocab.json"),
      `${JSON.stringify(localVocab, null, 2)}\n`,
    );
    await writeFile(
      join(schemasDir, "ext-vocab.json"),
      `${JSON.stringify(extVocab, null, 2)}\n`,
    );

    await generateSchemas({
      cwd: tempDir,
      schemasDir: "./schemas",
      path: "./schemas/**/*.json",
      outputDir: "./src/schemas",
    });

    const localSource = await Bun.file(
      join(tempDir, "src/schemas/local-vocab.zod.ts"),
    ).text();
    const extSource = await Bun.file(
      join(tempDir, "src/schemas/ext-vocab.zod.ts"),
    ).text();

    expect(localSource).toContain("z.fromJSONSchema");
    expect(localSource).not.toContain("compileJsonSchema");
    expect(localSource).not.toContain("...localVocabRaw");
    expect(extSource).toContain("compileJsonSchema");
    expect(extSource).not.toContain("...extVocabRaw");
    expect(extSource).toContain("$defs: extVocabRaw.$defs");

    const { zLocalVocabDefDelta } = await import(
      join(tempDir, "src/schemas/local-vocab.zod.ts")
    );
    const { zExtVocabDefDelta } = await import(
      join(tempDir, "src/schemas/ext-vocab.zod.ts")
    );

    const samples: unknown[] = [
      deltaValue,
      { value: "x" },
      { value: 1 },
      tagValue,
      42,
    ];
    for (const sample of samples) {
      expect(zLocalVocabDefDelta.safeParse(sample).success).toBe(
        zExtVocabDefDelta.safeParse(sample).success,
      );
    }
    expect(zLocalVocabDefDelta.safeParse(deltaValue).success).toBe(true);
    expect(zExtVocabDefDelta.safeParse(deltaValue).success).toBe(true);
    expect(zLocalVocabDefDelta.safeParse({ value: "x" }).success).toBe(false);
    expect(zExtVocabDefDelta.safeParse({ value: "x" }).success).toBe(false);
  });

  test("generated types stay real and tsc --noEmit is clean under zod 4.6.5", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zodforge-vocab-tsc-"));
    const schemasDir = join(tempDir, "schemas");
    await mkdir(schemasDir, { recursive: true });
    await writeFile(
      join(schemasDir, "vocab.json"),
      `${JSON.stringify(vocab, null, 2)}\n`,
    );
    await writeFile(
      join(schemasDir, "split.json"),
      `${JSON.stringify(oneOfRoot, null, 2)}\n`,
    );

    await generateSchemas({
      cwd: tempDir,
      schemasDir: "./schemas",
      path: "./schemas/**/*.json",
      outputDir: "./src/schemas",
    });

    const vocabSource = await Bun.file(
      join(tempDir, "src/schemas/vocab.zod.ts"),
    ).text();
    expect(vocabSource).toContain("export type VocabDefDelta = {");
    expect(vocabSource).toContain("z.ZodType<VocabDefDelta, VocabDefDelta>");
    expect(vocabSource).not.toContain("z.infer<");

    await writeFile(
      join(tempDir, "package.json"),
      `${JSON.stringify(
        {
          name: "zodforge-def-exports-repro",
          type: "module",
          dependencies: { zod: "4.6.5" },
          devDependencies: { typescript: "5.9.3" },
        },
        null,
        2,
      )}\n`,
    );
    await Bun.$`bun install`.cwd(tempDir);

    await writeFile(
      join(tempDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            resolveJsonModule: true,
          },
          include: ["src/**/*.ts", "schemas/**/*.json", "typecheck.ts"],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(tempDir, "typecheck.ts"),
      `import { zVocab, zVocabDefDelta, type VocabDefDelta } from "./src/schemas/vocab.zod";
import { zSplitDefPayload, type SplitDefPayload } from "./src/schemas/split.zod";

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const _delta: Equals<VocabDefDelta, { value: number; direction?: "up" | "down" }> = true;
const _payload: Equals<SplitDefPayload, { n: number }> = true;

const okDelta: VocabDefDelta = { value: 1, direction: "up" };
const parsed: VocabDefDelta = zVocabDefDelta.parse({ value: 1, direction: "up" });
const okPayload: SplitDefPayload = zSplitDefPayload.parse({ n: 1 });
void okDelta;
void parsed;
void okPayload;
void _delta;
void _payload;
void zVocab;

// @ts-expect-error value must be a number
const badDelta: VocabDefDelta = { value: "x" };
void badDelta;
`,
    );

    const proc = Bun.spawn(
      [
        join(tempDir, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "-p",
        "tsconfig.json",
      ],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  });
});
