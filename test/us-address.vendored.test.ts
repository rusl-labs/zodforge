/**
 * End-to-end against the real Rusl-vendored tree:
 *   ./schemas  →  generate  →  ./src/schemas  →  import & parse
 *
 * Requires `rusl install` (schemas/pragmatic/us-address.schema.json present).
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { generateSchemas } from "../src/index.ts";

const repoRoot = join(import.meta.dir, "..");

const validAddress = {
  $kind: "https://resources.rusl.com/resources/pragmatic/schemas/us-address",
  street1: "1 Broadway",
  city: "Oakland",
  region: "CA",
  postalCode: "94607",
  countryCode: "US" as const,
  geo: {
    type: "Point" as const,
    coordinates: [-122.2711, 37.8044],
  },
};

describe("real schemas: us-address", () => {
  beforeAll(async () => {
    try {
      await access(join(repoRoot, "schemas/pragmatic/us-address.schema.json"));
    } catch {
      throw new Error(
        "Expected ./schemas/pragmatic/us-address.schema.json — run `rusl install`.",
      );
    }

    await generateSchemas({
      cwd: repoRoot,
      schemasDir: "./schemas",
      path: "./schemas/**/*.json",
      outputDir: "./src/schemas",
    });
  });

  test("generated us-address imports geo + subdivision and validates", async () => {
    const addressZodPath = join(
      repoRoot,
      "src/schemas/pragmatic/us-address.zod.ts",
    );
    const source = await Bun.file(addressZodPath).text();

    expect(source).toContain('from "./geo.zod"');
    expect(source).toContain('from "./subdivision-code.zod"');
    expect(source).toContain("zPragmaticGeoDefPoint");
    expect(source).toContain("zPragmaticSubdivisionCodeDefUs");
    expect(source).toContain("compileJsonSchema");

    const { zPragmaticUsAddress } = await import(addressZodPath);

    expect(zPragmaticUsAddress.safeParse(validAddress).success).toBe(true);
    expect(
      zPragmaticUsAddress.safeParse({ ...validAddress, region: "ZZ" }).success,
    ).toBe(false);
    expect(
      zPragmaticUsAddress.safeParse({
        ...validAddress,
        geo: { type: "Point", coordinates: [999, 37.8] },
      }).success,
    ).toBe(false);
  });
});
