import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { glob } from "tinyglobby";
import { generateSchemas } from "./generate.js";
import { DEFAULT_OUTPUT_DIR, MANIFEST_FILENAME } from "./types.js";
import type { GenerateOptions } from "./types.js";

async function collectFiles(root: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const files = await glob("**/*", { cwd: root, absolute: true, onlyFiles: true });

  for (const absolutePath of files) {
    if (absolutePath.endsWith(MANIFEST_FILENAME)) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
    entries.set(relativePath, content);
  }

  return entries;
}

export async function verifyGeneratedSchemas(
  options: GenerateOptions = {},
): Promise<{ ok: true } | { ok: false; stale: string[] }> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const tempDir = await mkdtemp(join(tmpdir(), "zodforge-verify-"));
  const tempOutput = join(tempDir, outputDir);

  try {
    await cp(join(cwd, "schemas"), join(tempDir, "schemas"), { recursive: true });

    await generateSchemas({
      ...options,
      cwd: tempDir,
      outputDir,
    });

    const [expected, actual] = await Promise.all([
      collectFiles(tempOutput),
      collectFiles(resolve(cwd, outputDir)),
    ]);

    const stale: string[] = [];

    for (const [file, content] of expected) {
      if (actual.get(file) !== content) {
        stale.push(file);
      }
    }

    for (const file of actual.keys()) {
      if (!expected.has(file)) {
        stale.push(`+${file}`);
      }
    }

    if (stale.length > 0) {
      return { ok: false, stale: stale.sort() };
    }

    return { ok: true };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
