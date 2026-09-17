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
  test("open objects preserve extra columns when properties contain refs", () => {
    const x = compileJsonSchema({ type: "string" });
    const row = { x: "Jan", revenue: 12, breakdown: [{ value: 12 }] };
    for (const additional of [{}, { additionalProperties: true }]) {
      const schema = compileJsonSchema(
        {
          type: "object",
          properties: { x: { $ref: "https://example.com/x" } },
          required: ["x"],
          ...additional,
        },
        { external: { "https://example.com/x": x } },
      );
      expect(schema.parse(row)).toEqual(row);
      expect(schema.safeParse({ revenue: 12 }).success).toBe(false);
      expect(schema.safeParse({ x: 42, revenue: 12 }).success).toBe(false);
    }
  });

  test.each(["anyOf", "oneOf", "allOf"])(
    "%s cannot reopen a closed sibling",
    (applicator) => {
      const { anyOf, ...closed } = schemaB;
      const schema = compileJsonSchema(
        { ...closed, [applicator]: anyOf },
        { external: { "https://example.com/a": compileJsonSchema(schemaA) } },
      );
      const value = {
        kind: "widget",
        ...(applicator === "allOf" ? { cells: ["a"] } : {}),
        rows: [{ x: "Jan", revenue: 12 }],
      };
      expect(schema.parse(value)).toEqual(value);
      expect(schema.safeParse({ ...value, extra: true }).success).toBe(false);
    },
  );

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

    const { zB } = await import(join(tempDir, "src/schemas/b.zod.ts"));
    expect(zB.safeParse(42).success).toBe(false);
    expect(zB.safeParse({ kind: "nope" }).success).toBe(false);
    expect(zB.safeParse({ kind: "widget" }).success).toBe(false);
    expect(zB.safeParse({ kind: "widget", cells: ["a"] }).success).toBe(true);
    expect(
      zB.safeParse({ kind: "widget", rows: [{ x: "1" }] }).success,
    ).toBe(true);
    const wideRows = {
      kind: "widget",
      rows: [{ x: "Jan", revenue: 12, breakdown: [{ value: 12 }] }],
    };
    expect(zB.parse(wideRows)).toEqual(wideRows);
    expect(
      zB.safeParse({ ...wideRows, extra: true }).success,
    ).toBe(false);

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
import { type A } from "./src/schemas/a.zod";

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const _kind: Equals<B["kind"], "widget"> = true;
const _union: Equals<Kind, { kind: "alpha" } | { kind: "beta" }> = true;

type RequiredOnly = ${jsonSchemaToTs(
  { required: ["x"] },
  { resolveRef: () => "never" },
)};
const openRequired: RequiredOnly = { x: "Jan", revenue: 12 };
const _requiredExtra: Equals<RequiredOnly["revenue"], unknown> = true;
// @ts-expect-error open fragments still require their declared key
const missingRequired: RequiredOnly = { revenue: 12 };
void openRequired;
void _requiredExtra;
void missingRequired;

const okCells: B = { kind: "widget", cells: ["a"] };
const okRows: B = { kind: "widget", rows: [{ x: "Jan", revenue: 12, breakdown: [{ value: 12 }] }] };
type Row = NonNullable<B["rows"]>[number];
const _dynamicColumn: Equals<Row["revenue"], unknown> = true;
const _knownColumn: Equals<Row["x"], string | undefined> = true;
void _dynamicColumn;
void _knownColumn;
const parsed: B = zB.parse({ kind: "widget", cells: ["a"] });
void okCells;
void okRows;
void parsed;
void _kind;
void _union;

// @ts-expect-error required-only alternatives must not open the closed parent
const badExtra: B = { kind: "widget", cells: ["a"], extra: true };
void badExtra;
// @ts-expect-error closed parents do not expose arbitrary indexed properties
type Extra = B["extra"];
type ClosedOneOf = ${jsonSchemaToTs(
  { ...schemaB, anyOf: undefined, oneOf: schemaB.anyOf },
  { resolveRef: () => "A" },
)};
type ClosedAllOf = ${jsonSchemaToTs(
  { ...schemaB, anyOf: undefined, allOf: schemaB.anyOf },
  { resolveRef: () => "A" },
)};
const oneOfRows: ClosedOneOf = { kind: "widget", rows: [{ x: "Jan", revenue: 12 }] };
const allOfRows: ClosedAllOf = { kind: "widget", cells: ["a"], rows: [{ x: "Jan", revenue: 12 }] };
// @ts-expect-error oneOf fragments must not reopen the closed parent
const badOneOf: ClosedOneOf = { kind: "widget", cells: ["a"], extra: true };
// @ts-expect-error allOf fragments must not reopen the closed parent
const badAllOf: ClosedAllOf = { kind: "widget", cells: ["a"], rows: [], extra: true };
void oneOfRows;
void allOfRows;
void badOneOf;
void badAllOf;

type ClosedNumeric = ${jsonSchemaToTs(
  {
    type: "object",
    properties: { x: {} },
    required: ["x"],
    additionalProperties: false,
    anyOf: [{ additionalProperties: { type: "number" } }],
  },
  { resolveRef: () => "never" },
)};
const numeric: ClosedNumeric = { x: 1 };
// @ts-expect-error schema-valued catchalls still constrain the sibling's keys
const nonNumeric: ClosedNumeric = { x: "bad" };
void numeric;
void nonNumeric;

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
