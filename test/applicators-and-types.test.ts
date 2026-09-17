import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { compileJsonSchema, generateSchemas } from "../src/index.ts";
import { jsonSchemaToTs } from "../src/schema-types.ts";

const schemaA = {
  $id: "https://example.com/a",
  type: "object",
  properties: {
    x: { type: "string" },
  },
} as const;

const schemaB = {
  $id: "https://example.com/b",
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { const: "widget" },
    cells: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { $ref: "https://example.com/a" } },
  },
  anyOf: [{ required: ["cells"] }, { required: ["rows"] }],
} as const;

const schemaBInlined = {
  $id: "https://example.com/b-inlined",
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { const: "widget" },
    cells: { type: "array", items: { type: "string" } },
    rows: {
      type: "array",
      items: { type: "object", properties: { x: { type: "string" } } },
    },
  },
  anyOf: [{ required: ["cells"] }, { required: ["rows"] }],
} as const;

const schemaKind = {
  $id: "https://example.com/kind",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "alpha" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "beta" } },
    },
  ],
} as const;

const samples: unknown[] = [
  42,
  { kind: "nope" },
  { kind: "widget" },
  { kind: "widget", cells: ["a"] },
  { kind: "widget", rows: [{ x: "1" }] },
  { kind: "widget", rows: [{ x: 1 }] },
  { kind: "widget", cells: "nope" },
  { kind: "widget", cells: ["a"], extra: true },
];

function compileBWithRef() {
  const a = compileJsonSchema(schemaA);
  return compileJsonSchema(schemaB, {
    external: { "https://example.com/a": a },
  });
}

describe("sibling applicators keep object constraints", () => {
  test("anyOf beside properties/$ref rejects scalars and wrong const", () => {
    const b = compileBWithRef();

    expect(b.safeParse(42).success).toBe(false);
    expect(b.safeParse({ kind: "nope" }).success).toBe(false);
    expect(b.safeParse({ kind: "widget" }).success).toBe(false);
    expect(b.safeParse({ kind: "widget", cells: ["a"] }).success).toBe(true);
    expect(
      b.safeParse({ kind: "widget", rows: [{ x: "1" }] }).success,
    ).toBe(true);
  });

  test("type: string with sibling oneOf of patterns still enforces type", () => {
    const barPattern = compileJsonSchema({
      type: "string",
      pattern: "^bar",
    });
    const schema = compileJsonSchema(
      {
        type: "string",
        oneOf: [{ pattern: "^foo" }, { $ref: "https://example.com/bar-pattern" }],
      },
      {
        external: { "https://example.com/bar-pattern": barPattern },
      },
    );

    expect(schema.safeParse("foo1").success).toBe(true);
    expect(schema.safeParse("bar1").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(false);
  });

  test("ref-containing applicator node matches the inlined fromJSONSchema tree", () => {
    const withRef = compileBWithRef();
    const inlined = compileJsonSchema(schemaBInlined);

    for (const sample of samples) {
      expect(withRef.safeParse(sample).success).toBe(
        inlined.safeParse(sample).success,
      );
    }
  });

  test("pure applicator (no siblings) still accepts either branch", () => {
    const a = compileJsonSchema(schemaA);
    const schema = compileJsonSchema(
      {
        anyOf: [{ $ref: "https://example.com/a" }, { type: "number" }],
      },
      { external: { "https://example.com/a": a } },
    );

    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse({ x: "ok" }).success).toBe(true);
    expect(schema.safeParse(true).success).toBe(false);
  });

  test("allOf beside object constraints is intersected, not a replacement", () => {
    const extra = compileJsonSchema({
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
    });
    const schema = compileJsonSchema(
      {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string" },
          extra: { $ref: "https://example.com/extra" },
        },
        allOf: [{ required: ["extra"] }],
      },
      { external: { "https://example.com/extra": extra } },
    );

    expect(schema.safeParse(42).success).toBe(false);
    expect(schema.safeParse({ label: "x" }).success).toBe(false);
    expect(
      schema.safeParse({ label: "x", extra: { n: 1 } }).success,
    ).toBe(true);
  });

  test("sibling not/$ref beside an applicator compiles instead of throwing", () => {
    const forbidden = compileJsonSchema({ const: "nope" });
    const schema = compileJsonSchema(
      {
        type: "string",
        anyOf: [{ minLength: 1 }],
        not: { $ref: "https://example.com/forbidden" },
      },
      { external: { "https://example.com/forbidden": forbidden } },
    );

    expect(schema.safeParse("ok").success).toBe(true);
    expect(schema.safeParse("nope").success).toBe(false);
    expect(schema.safeParse(42).success).toBe(false);
  });

  test("sibling if/then with $ref beside an applicator compiles", () => {
    const widgetIf = compileJsonSchema({
      type: "object",
      properties: { kind: { const: "widget" } },
      required: ["kind"],
    });
    const schema = compileJsonSchema(
      {
        type: "object",
        properties: {
          kind: { type: "string" },
          n: { type: "number" },
        },
        anyOf: [{ required: ["kind"] }],
        if: { $ref: "https://example.com/widget-if" },
        then: { required: ["n"] },
      },
      { external: { "https://example.com/widget-if": widgetIf } },
    );

    expect(schema.safeParse({ kind: "other" }).success).toBe(true);
    expect(schema.safeParse({ kind: "widget" }).success).toBe(false);
    expect(schema.safeParse({ kind: "widget", n: 1 }).success).toBe(true);
  });

  test("sibling propertyNames $ref beside an applicator compiles", () => {
    const ident = compileJsonSchema({ type: "string", pattern: "^[a-z]+$" });
    const schema = compileJsonSchema(
      {
        type: "object",
        anyOf: [{ minProperties: 0 }],
        propertyNames: { $ref: "https://example.com/ident" },
      },
      { external: { "https://example.com/ident": ident } },
    );

    expect(schema.safeParse({ abc: 1 }).success).toBe(true);
    expect(schema.safeParse({ ABC: 1 }).success).toBe(false);
  });
});

describe("jsonSchemaToTs", () => {
  test("const, closed objects, and oneOf unions", () => {
    expect(jsonSchemaToTs({ const: "widget" }, { resolveRef: () => "never" })).toBe(
      '"widget"',
    );
    expect(
      jsonSchemaToTs(
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "widget" } },
        },
        { resolveRef: () => "never" },
      ),
    ).toBe('{ kind: "widget" }');
    expect(
      jsonSchemaToTs(schemaKind, { resolveRef: () => "never" }),
    ).toBe('{ kind: "alpha" } | { kind: "beta" }');
  });

  test("external $ref and sibling anyOf on b.json", () => {
    const tsType = jsonSchemaToTs(schemaB, {
      resolveRef: (ref) => {
        if (ref === "https://example.com/a") {
          return "A";
        }
        throw new Error(`unexpected ref ${ref}`);
      },
    });

    expect(tsType).toBe(
      '{ kind: "widget"; cells?: Array<string>; rows?: Array<A> } & ({ cells: unknown } | { rows: unknown })',
    );
  });
});

describe("generated types and validators", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("generated b rejects invalid values and tsc sees real types", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zodforge-types-"));
    const schemasDir = join(tempDir, "schemas");
    await mkdir(schemasDir, { recursive: true });
    await writeFile(join(schemasDir, "a.json"), `${JSON.stringify(schemaA, null, 2)}\n`);
    await writeFile(join(schemasDir, "b.json"), `${JSON.stringify(schemaB, null, 2)}\n`);
    await writeFile(
      join(schemasDir, "kind.json"),
      `${JSON.stringify(schemaKind, null, 2)}\n`,
    );

    await generateSchemas({
      cwd: tempDir,
      schemasDir: "./schemas",
      path: "./schemas/**/*.json",
      outputDir: "./src/schemas",
    });

    await writeFile(
      join(tempDir, "package.json"),
      `${JSON.stringify(
        {
          name: "zodforge-types-repro",
          type: "module",
          dependencies: { zod: "4.6.5" },
          devDependencies: { typescript: "5.9.3" },
        },
        null,
        2,
      )}\n`,
    );
    await Bun.$`bun install`.cwd(tempDir);

    const bSource = await Bun.file(join(tempDir, "src/schemas/b.zod.ts")).text();
    expect(bSource).toContain('from "./a.zod"');
    expect(bSource).toContain("type A");
    expect(bSource).toContain('kind: "widget"');
    expect(bSource).toContain("export type B =");
    expect(bSource).not.toContain("z.infer<");
    expect(bSource).toContain("z.ZodType<B, B>");

    const { zB } = await import(join(tempDir, "src/schemas/b.zod.ts"));
    expect(zB.safeParse(42).success).toBe(false);
    expect(zB.safeParse({ kind: "nope" }).success).toBe(false);
    expect(zB.safeParse({ kind: "widget" }).success).toBe(false);
    expect(zB.safeParse({ kind: "widget", cells: ["a"] }).success).toBe(true);
    expect(
      zB.safeParse({ kind: "widget", rows: [{ x: "1" }] }).success,
    ).toBe(true);

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
      `import { zB, type B } from "./src/schemas/b.zod";
import { type Kind } from "./src/schemas/kind.zod";

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const _kind: Equals<B["kind"], "widget"> = true;
const _union: Equals<Kind, { kind: "alpha" } | { kind: "beta" }> = true;

const okCells: B = { kind: "widget", cells: ["a"] };
const okRows: B = { kind: "widget", rows: [{ x: "1" }] };
const parsed: B = zB.parse({ kind: "widget", cells: ["a"] });
void okCells;
void okRows;
void parsed;
void _kind;
void _union;

// @ts-expect-error 42 is not B
const badNumber: B = 42;
void badNumber;
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
