import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import * as z from "zod";
import {
  computePathId,
  forgeSchemas,
  generateSchemas,
  cleanGeneratedSchemas,
  schemaExportName,
  stemFromFilename,
  typeExportName,
  defSchemaExportName,
  defTypeExportName,
  MANIFEST_FILENAME,
} from "./src/index.ts";
import { verifyGeneratedSchemas } from "./src/verify.ts";
import { cleanGeneratedSchemas as cleanFromCleanModule } from "./src/clean.ts";

const fixtureRoot = join(import.meta.dir, "test/fixtures/schemas");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("naming", () => {
  test("stemFromFilename strips suffix segments", () => {
    expect(stemFromFilename("trust-signal.schema.json")).toBe("trust-signal");
    expect(stemFromFilename("baz.schema.json")).toBe("baz");
  });

  test("schema and type export names", () => {
    expect(schemaExportName("trust-signal")).toBe("trustSignalSchema");
    expect(typeExportName("trust-signal")).toBe("TrustSignal");
    expect(schemaExportName("baz")).toBe("bazSchema");
    expect(typeExportName("baz")).toBe("Baz");
  });

  test("def export names are prefixed by schema stem", () => {
    expect(defSchemaExportName("common", "account-slug")).toBe(
      "commonDefAccountSlugSchema",
    );
    expect(defTypeExportName("common", "account-slug")).toBe(
      "CommonDefAccountSlug",
    );
    expect(defSchemaExportName("common", "schema-ref")).toBe(
      "commonDefSchemaRefSchema",
    );
  });
});

describe("resolve", () => {
  test("computePathId mirrors schema tree", () => {
    const schemasDir = join(fixtureRoot);
    expect(
      computePathId(
        join(schemasDir, "rusl/trust-signal.json"),
        schemasDir,
      ),
    ).toBe("rusl/trust-signal");
    expect(
      computePathId(join(schemasDir, "foo/baz.schema.json"), schemasDir),
    ).toBe("foo/baz");
  });
});

describe("forgeSchemas", () => {
  test("loads schemas with byPath and byId maps", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/*.json",
    });

    expect(forged.trustSignalSchema).toBeDefined();
    expect(forged.contextRequestSchema).toBeDefined();
    expect(forged.commonDefAccountSlugSchema).toBeDefined();
    expect(forged.byPath["rusl/trust-signal"]).toBe(forged.trustSignalSchema);
    expect(forged.byPath["rusl/common#/$defs/account-slug"]).toBe(
      forged.commonDefAccountSlugSchema,
    );
    expect(
      forged.byId[
        "https://resources.rusl.com/resources/rusl/schemas/common#/$defs/account-slug"
      ],
    ).toBe(forged.commonDefAccountSlugSchema);
    expect(forged.byId["https://resources.rusl.com/schemas/rusl/trust-signal"]).toBe(
      forged.trustSignalSchema,
    );
  });

  test("def schemas validate independently of defs-only root", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/common.schema.json",
    });

    expect(forged.commonSchema).toBeUndefined();
    expect(forged.commonDefAccountSlugSchema.safeParse("ab").success).toBe(
      false,
    );
    expect(forged.commonDefAccountSlugSchema.safeParse("my-account").success).toBe(
      true,
    );
  });

  test(".meta() registers in globalRegistry", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/trust-signal.json",
    });

    expect(z.globalRegistry.has(forged.trustSignalSchema)).toBe(true);
    expect(z.globalRegistry.get(forged.trustSignalSchema)?.pathId).toBe(
      "rusl/trust-signal",
    );
  });

  test("duplicate $id throws", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "zodforge-dup-"));
    const schemasDir = join(tempDir, "schemas");
    await Bun.write(
      join(schemasDir, "a.json"),
      JSON.stringify({
        $id: "https://example.com/dup",
        type: "string",
      }),
    );
    await Bun.write(
      join(schemasDir, "nested/b.json"),
      JSON.stringify({
        $id: "https://example.com/dup",
        type: "number",
      }),
    );

    await expect(
      forgeSchemas({
        cwd: tempDir,
        schemasDir: "./schemas",
        path: "./schemas/**/*.json",
      }),
    ).rejects.toThrow(/Duplicate \$id/);

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("generateSchemas", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zodforge-gen-"));
    await Bun.$`cp -R ${fixtureRoot} ${join(tempDir, "schemas")}`;
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("mirrors schema tree with barrels and lookup", async () => {
    const outputDir = "./src/schemas";
    const manifest = await generateSchemas({
      cwd: tempDir,
      outputDir,
    });

    const generatedRoot = join(tempDir, outputDir);
    expect(await pathExists(join(generatedRoot, "rusl/trust-signal.ts"))).toBe(
      true,
    );
    expect(await pathExists(join(generatedRoot, "foo/baz.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/bar/qux.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/bar/index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "rusl/index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "_lookup.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, MANIFEST_FILENAME))).toBe(true);

    const trustSignal = await readFile(
      join(generatedRoot, "rusl/trust-signal.ts"),
      "utf8",
    );
    expect(trustSignal).toContain("const trustSignalJsonMeta = trustSignalJson as {");
    expect(trustSignal).toContain(
      "z.fromJSONSchema(trustSignalJson as Parameters<typeof z.fromJSONSchema>[0]).meta({",
    );
    expect(trustSignal).toContain('pathId: "rusl/trust-signal"');
    expect(trustSignal).toContain("export type TrustSignal = z.infer");

    const common = await readFile(
      join(generatedRoot, "rusl/common.ts"),
      "utf8",
    );
    expect(common).not.toContain("export const commonSchema");
    expect(common).toContain("export const commonDefAccountSlugSchema");
    expect(common).toContain('pathId: "rusl/common#/$defs/account-slug"');
    expect(common).toContain('$ref: "#/$defs/account-slug"');

    const lookup = await readFile(join(generatedRoot, "_lookup.ts"), "utf8");
    expect(lookup).toContain("commonDefAccountSlugSchema");
    expect(lookup).not.toContain("commonSchema");

    const fooBarrel = await readFile(join(generatedRoot, "foo/index.ts"), "utf8");
    expect(fooBarrel).toContain('export * from "./baz";');
    expect(fooBarrel).toContain('export * from "./bar";');

    const rootBarrel = await readFile(join(generatedRoot, "index.ts"), "utf8");
    expect(rootBarrel).toContain('export * from "./foo";');
    expect(rootBarrel).toContain('export * from "./rusl";');
    expect(rootBarrel).toContain('export * from "./_lookup";');

    expect(manifest.files).toContain("rusl/trust-signal.ts");
    expect(manifest.files).toContain("index.ts");
  });

  test("regenerate with no schemas wipes stale output directory", async () => {
    const outputDir = "./src/schemas";
    await generateSchemas({ cwd: tempDir, outputDir });

    const generatedRoot = join(tempDir, outputDir);
    expect(await pathExists(join(generatedRoot, "foo/baz.ts"))).toBe(true);

    await rm(join(tempDir, "schemas"), { recursive: true, force: true });

    await generateSchemas({ cwd: tempDir, outputDir });

    expect(await pathExists(join(generatedRoot, "foo"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "rusl"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "_lookup.ts"))).toBe(true);

    const rootBarrel = await readFile(join(generatedRoot, "index.ts"), "utf8");
    expect(rootBarrel).not.toContain('export * from "./foo";');
    expect(rootBarrel).not.toContain('export * from "./rusl";');
  });

  test("regenerate removes stale files from prior manifest", async () => {
    const outputDir = "./src/schemas";
    await generateSchemas({ cwd: tempDir, outputDir });

    const generatedRoot = join(tempDir, outputDir);
    expect(await pathExists(join(generatedRoot, "foo/baz.ts"))).toBe(true);

    await rm(join(tempDir, "schemas/foo"), { recursive: true, force: true });

    await generateSchemas({ cwd: tempDir, outputDir });

    expect(await pathExists(join(generatedRoot, "foo/baz.ts"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "foo/bar/qux.ts"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "foo"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "rusl/trust-signal.ts"))).toBe(
      true,
    );

    const rootBarrel = await readFile(join(generatedRoot, "index.ts"), "utf8");
    expect(rootBarrel).not.toContain('export * from "./foo";');
    expect(rootBarrel).toContain('export * from "./rusl";');
  });

  test("clean removes generated files and empty directories", async () => {
    const outputDir = "./src/schemas";
    await generateSchemas({ cwd: tempDir, outputDir });

    const generatedRoot = join(tempDir, outputDir);
    const cleanResult = await cleanFromCleanModule({
      cwd: tempDir,
      outputDir,
    });

    expect(cleanResult.removed.length).toBeGreaterThan(0);
    expect(await pathExists(join(generatedRoot, "rusl/trust-signal.ts"))).toBe(
      false,
    );
    expect(await pathExists(join(generatedRoot, MANIFEST_FILENAME))).toBe(false);
    expect(await pathExists(generatedRoot)).toBe(true);

    const nestedFooBar = join(generatedRoot, "foo/bar");
    expect(await pathExists(nestedFooBar)).toBe(false);

    await generateSchemas({ cwd: tempDir, outputDir });
    expect(await pathExists(join(generatedRoot, "rusl/trust-signal.ts"))).toBe(
      true,
    );
  });

  test("clean without manifest warns and no-ops", async () => {
    const result = await cleanGeneratedSchemas({
      cwd: tempDir,
      outputDir: "./missing-output",
    });

    expect(result.removed).toEqual([]);
    expect(result.warned).toContain("No manifest found");
  });
});

describe("verifyGeneratedSchemas", () => {
  test("passes when derived output matches source", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "zodforge-verify-"));
    await Bun.$`cp -R ${fixtureRoot} ${join(tempDir, "schemas")}`;

    const outputDir = "./src/schemas";
    await generateSchemas({ cwd: tempDir, outputDir });

    const result = await verifyGeneratedSchemas({ cwd: tempDir, outputDir });
    expect(result.ok).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  test("fails when derived output is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "zodforge-verify-fail-"));
    await Bun.$`cp -R ${fixtureRoot} ${join(tempDir, "schemas")}`;

    const result = await verifyGeneratedSchemas({
      cwd: tempDir,
      outputDir: "./src/schemas",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stale.length).toBeGreaterThan(0);
    }

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("defaults", () => {
  test("default glob resolves fixture schemas", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/**/*.json",
    });
    expect(forged.trustSignalSchema).toBeDefined();
    expect(forged.bazSchema).toBeDefined();
    expect(forged.byPath["foo/bar/qux"]).toBeDefined();
  });
});
