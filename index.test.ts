import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import * as z from "zod";
import {
  buildDocumentRegistry,
  buildExportCatalog,
  compileJsonSchema,
  computePathId,
  forgeSchemas,
  generateSchemas,
  cleanGeneratedSchemas,
  rawExportName,
  resolveExternalRef,
  zodExportName,
  stemFromFilename,
  typeExportName,
  zodDefExportName,
  nameBase,
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

  test("full mode export names use pathId", () => {
    const base = nameBase("rusl/trust-signal", "trust-signal", "full");
    expect(rawExportName(base)).toBe("ruslTrustSignalRaw");
    expect(zodExportName(base)).toBe("zRuslTrustSignal");
    expect(typeExportName(base)).toBe("RuslTrustSignal");
  });

  test("short mode export names use filename stem", () => {
    const base = nameBase("rusl/trust-signal", "trust-signal", "short");
    expect(rawExportName(base)).toBe("trustSignalRaw");
    expect(zodExportName(base)).toBe("zTrustSignal");
    expect(typeExportName(base)).toBe("TrustSignal");
  });

  test("full mode def export names use pathId", () => {
    const base = nameBase("rusl/common", "common", "full");
    expect(zodDefExportName(base, "account-slug")).toBe(
      "zRuslCommonDefAccountSlug",
    );
    expect(zodDefExportName(base, "schema-ref")).toBe(
      "zRuslCommonDefSchemaRef",
    );
  });

  test("short mode def export names use filename stem", () => {
    const base = nameBase("rusl/common", "common", "short");
    expect(zodDefExportName(base, "account-slug")).toBe(
      "zCommonDefAccountSlug",
    );
  });

  test("full mode avoids collisions for same filename in different paths", () => {
    const ruslBase = nameBase("rusl/schemas/foo", "foo", "full");
    const acmeBase = nameBase("acme/schemas/foo", "foo", "full");
    expect(zodExportName(ruslBase)).toBe("zRuslSchemasFoo");
    expect(zodExportName(acmeBase)).toBe("zAcmeSchemasFoo");
    expect(zodExportName(ruslBase)).not.toBe(zodExportName(acmeBase));
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
  test("loads schemas with byPath, byId, and raw maps", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/*.json",
    });

    expect(forged.zRuslTrustSignal).toBeDefined();
    expect(forged.zRuslContextRequest).toBeDefined();
    expect(forged.zRuslCommonDefAccountSlug).toBeDefined();
    expect(forged.ruslTrustSignalRaw).toBeDefined();
    expect(forged.ruslCommonRaw).toBeDefined();
    expect(forged.byPath["rusl/trust-signal"]).toBe(forged.zRuslTrustSignal);
    expect(forged.byPath["rusl/common#/$defs/account-slug"]).toBe(
      forged.zRuslCommonDefAccountSlug,
    );
    expect(forged.rawByPath["rusl/trust-signal"]).toBe(
      forged.ruslTrustSignalRaw,
    );
    expect(
      forged.byId[
        "https://resources.rusl.com/resources/rusl/schemas/common#/$defs/account-slug"
      ],
    ).toBe(forged.zRuslCommonDefAccountSlug);
    expect(forged.byId["https://resources.rusl.com/schemas/rusl/trust-signal"]).toBe(
      forged.zRuslTrustSignal,
    );
    expect(
      forged.rawById["https://resources.rusl.com/schemas/rusl/trust-signal"],
    ).toBe(forged.ruslTrustSignalRaw);
  });

  test("short naming mode uses filename-based exports", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/trust-signal.json",
      naming: "short",
    });

    expect(forged.zTrustSignal).toBeDefined();
    expect(forged.trustSignalRaw).toBeDefined();
    expect(forged.byPath["rusl/trust-signal"]).toBe(forged.zTrustSignal);
  });

  test("def schemas validate independently of defs-only root", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/common.schema.json",
    });

    expect(forged.zRuslCommon).toBeUndefined();
    expect(forged.zRuslCommonDefAccountSlug.safeParse("ab").success).toBe(
      false,
    );
    expect(forged.zRuslCommonDefAccountSlug.safeParse("my-account").success).toBe(
      true,
    );
  });

  test(".meta() registers in globalRegistry", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/rusl/trust-signal.json",
    });

    expect(z.globalRegistry.has(forged.zRuslTrustSignal)).toBe(true);
    expect(z.globalRegistry.get(forged.zRuslTrustSignal)?.pathId).toBe(
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

  test("mirrors schema tree with raw/zod files, barrels, and lookup", async () => {
    const outputDir = "./src/schemas";
    const manifest = await generateSchemas({
      cwd: tempDir,
      outputDir,
    });

    const generatedRoot = join(tempDir, outputDir);
    expect(
      await pathExists(join(generatedRoot, "rusl/trust-signal.raw.ts")),
    ).toBe(true);
    expect(
      await pathExists(join(generatedRoot, "rusl/trust-signal.zod.ts")),
    ).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/baz.raw.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/baz.zod.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/bar/qux.raw.ts"))).toBe(
      true,
    );
    expect(await pathExists(join(generatedRoot, "foo/bar/qux.zod.ts"))).toBe(
      true,
    );
    expect(await pathExists(join(generatedRoot, "foo/index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "foo/bar/index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "rusl/index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "_lookup.raw.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "_lookup.zod.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, MANIFEST_FILENAME))).toBe(true);

    const trustSignalRaw = await readFile(
      join(generatedRoot, "rusl/trust-signal.raw.ts"),
      "utf8",
    );
    expect(trustSignalRaw).toContain(
      "export const ruslTrustSignalRaw = trustSignalJson;",
    );
    expect(trustSignalRaw).toContain(
      "export type RuslTrustSignalRaw = typeof ruslTrustSignalRaw;",
    );
    expect(trustSignalRaw).not.toContain("fromJSONSchema");

    const trustSignalZod = await readFile(
      join(generatedRoot, "rusl/trust-signal.zod.ts"),
      "utf8",
    );
    expect(trustSignalZod).toContain(
      'import { ruslTrustSignalRaw } from "./trust-signal.raw";',
    );
    expect(trustSignalZod).toContain(
      "ruslTrustSignalRaw as Parameters<typeof z.fromJSONSchema>[0]",
    );
    expect(trustSignalZod).toContain('pathId: "rusl/trust-signal"');
    expect(trustSignalZod).toContain(
      "export type RuslTrustSignal = z.infer<typeof zRuslTrustSignal>",
    );

    const commonZod = await readFile(
      join(generatedRoot, "rusl/common.zod.ts"),
      "utf8",
    );
    expect(commonZod).not.toContain("export const zRuslCommon =");
    expect(commonZod).toContain("export const zRuslCommonDefAccountSlug");
    expect(commonZod).toContain('pathId: "rusl/common#/$defs/account-slug"');
    expect(commonZod).toContain('$ref: "#/$defs/account-slug"');

    const commonRaw = await readFile(
      join(generatedRoot, "rusl/common.raw.ts"),
      "utf8",
    );
    expect(commonRaw).toContain("export const ruslCommonRaw = commonJson;");

    const zodLookup = await readFile(
      join(generatedRoot, "_lookup.zod.ts"),
      "utf8",
    );
    expect(zodLookup).toContain("zRuslCommonDefAccountSlug");
    expect(zodLookup).not.toContain("zRuslCommon,");

    const rawLookup = await readFile(
      join(generatedRoot, "_lookup.raw.ts"),
      "utf8",
    );
    expect(rawLookup).toContain("ruslTrustSignalRaw");
    expect(rawLookup).toContain("getRawSchemaByIdentifier");

    const fooBarrel = await readFile(join(generatedRoot, "foo/index.ts"), "utf8");
    expect(fooBarrel).toContain('export * from "./baz.raw";');
    expect(fooBarrel).toContain('export * from "./baz.zod";');
    expect(fooBarrel).toContain('export * from "./bar";');

    const rootBarrel = await readFile(join(generatedRoot, "index.ts"), "utf8");
    expect(rootBarrel).toContain('export * from "./foo";');
    expect(rootBarrel).toContain('export * from "./rusl";');
    expect(rootBarrel).toContain('export * from "./_lookup.raw";');
    expect(rootBarrel).toContain('export * from "./_lookup.zod";');

    expect(manifest.files).toContain("rusl/trust-signal.raw.ts");
    expect(manifest.files).toContain("rusl/trust-signal.zod.ts");
    expect(manifest.files).toContain("index.ts");
  });

  test("short naming mode generates shorter exports", async () => {
    const outputDir = "./src/schemas";
    await generateSchemas({
      cwd: tempDir,
      outputDir,
      naming: "short",
    });

    const generatedRoot = join(tempDir, outputDir);
    const trustSignalZod = await readFile(
      join(generatedRoot, "rusl/trust-signal.zod.ts"),
      "utf8",
    );
    expect(trustSignalZod).toContain("export const zTrustSignal");
    expect(trustSignalZod).toContain(
      'import { trustSignalRaw } from "./trust-signal.raw";',
    );
  });

  test("regenerate with no schemas wipes stale output directory", async () => {
    const outputDir = "./src/schemas";
    await generateSchemas({ cwd: tempDir, outputDir });

    const generatedRoot = join(tempDir, outputDir);
    expect(await pathExists(join(generatedRoot, "foo/baz.raw.ts"))).toBe(true);

    await rm(join(tempDir, "schemas"), { recursive: true, force: true });

    await generateSchemas({ cwd: tempDir, outputDir });

    expect(await pathExists(join(generatedRoot, "foo"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "rusl"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "index.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "_lookup.raw.ts"))).toBe(true);
    expect(await pathExists(join(generatedRoot, "_lookup.zod.ts"))).toBe(true);

    const rootBarrel = await readFile(join(generatedRoot, "index.ts"), "utf8");
    expect(rootBarrel).not.toContain('export * from "./foo";');
    expect(rootBarrel).not.toContain('export * from "./rusl";');
  });

  test("regenerate removes stale files from prior manifest", async () => {
    const outputDir = "./src/schemas";
    await generateSchemas({ cwd: tempDir, outputDir });

    const generatedRoot = join(tempDir, outputDir);
    expect(await pathExists(join(generatedRoot, "foo/baz.raw.ts"))).toBe(true);

    await rm(join(tempDir, "schemas/foo"), { recursive: true, force: true });

    await generateSchemas({ cwd: tempDir, outputDir });

    expect(await pathExists(join(generatedRoot, "foo/baz.raw.ts"))).toBe(false);
    expect(await pathExists(join(generatedRoot, "foo/bar/qux.raw.ts"))).toBe(
      false,
    );
    expect(await pathExists(join(generatedRoot, "foo"))).toBe(false);
    expect(
      await pathExists(join(generatedRoot, "rusl/trust-signal.raw.ts")),
    ).toBe(true);

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
    expect(
      await pathExists(join(generatedRoot, "rusl/trust-signal.raw.ts")),
    ).toBe(false);
    expect(await pathExists(join(generatedRoot, MANIFEST_FILENAME))).toBe(false);
    expect(await pathExists(generatedRoot)).toBe(true);

    const nestedFooBar = join(generatedRoot, "foo/bar");
    expect(await pathExists(nestedFooBar)).toBe(false);

    await generateSchemas({ cwd: tempDir, outputDir });
    expect(
      await pathExists(join(generatedRoot, "rusl/trust-signal.raw.ts")),
    ).toBe(true);
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

describe("external $ref catalog", () => {
  test("resolves Rusl $id aliases and def fragments to export targets", () => {
    const geo = {
      $id: "https://resources.rusl.com/resources/pragmatic/schemas/geo",
      $defs: {
        point: { type: "object" },
      },
    };
    const docs = [
      {
        json: geo,
        absolutePath: "/schemas/geo.json",
        pathId: "pragmatic/geo",
        stem: "geo",
      },
    ];
    const registry = buildDocumentRegistry(docs);
    const catalog = buildExportCatalog(docs, "full");

    const target = resolveExternalRef(
      "https://resources.rusl.com/resources/pragmatic/geo#/$defs/point",
      registry,
      catalog,
    );
    expect(target.zodExport).toBe("zPragmaticGeoDefPoint");
    expect(target.pathId).toBe("pragmatic/geo");
  });

  test("compileJsonSchema wires external map entries", () => {
    const point = compileJsonSchema({
      type: "object",
      properties: {
        type: { const: "Point" },
        coordinates: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 3,
        },
      },
      required: ["type", "coordinates"],
      additionalProperties: false,
    });

    const address = compileJsonSchema(
      {
        type: "object",
        properties: {
          geo: {
            $ref: "https://example.com/geo#/$defs/point",
          },
        },
        required: ["geo"],
      },
      {
        external: {
          "https://example.com/geo#/$defs/point": point,
        },
      },
    );

    expect(
      address.safeParse({
        geo: { type: "Point", coordinates: [1, 2] },
      }).success,
    ).toBe(true);
    expect(
      address.safeParse({
        geo: { type: "Point", coordinates: [1] },
      }).success,
    ).toBe(false);
  });
});

describe("defaults", () => {
  test("default glob resolves fixture schemas", async () => {
    const forged = await forgeSchemas({
      cwd: import.meta.dir,
      schemasDir: "./test/fixtures/schemas",
      path: "./test/fixtures/schemas/**/*.json",
    });
    expect(forged.zRuslTrustSignal).toBeDefined();
    expect(forged.zFooBaz).toBeDefined();
    expect(forged.byPath["foo/bar/qux"]).toBeDefined();
    expect(forged.ruslTrustSignalRaw).toBeDefined();
  });
});
