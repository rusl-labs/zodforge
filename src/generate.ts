import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileLoadedSchemas, computeJsonImportPath, loadSchemas } from "./compile.js";
import { wipeOutputDirectory, writeGeneratedFile } from "./fs.js";
import { resolveSchemaFiles } from "./resolve.js";
import {
  renderBarrelFile,
  renderCompileHelperFile,
  renderManifestFile,
  renderRawFile,
  renderRawLookupFile,
  renderRootIndexFile,
  renderZodFile,
  renderZodLookupFile,
} from "./templates.js";
import {
  DEFAULT_OUTPUT_DIR,
  MANIFEST_FILENAME,
  type CompiledSchema,
  type GenerateOptions,
  type RawLookupEntry,
  type ZodLookupEntry,
  type ZodforgeManifest,
} from "./types.js";
import { assertUniqueIdentifiers } from "./unique.js";

function collectDirectoriesForPath(pathId: string): string[] {
  const parts = pathId.split("/");
  const directories: string[] = [];

  for (let index = 0; index < parts.length - 1; index += 1) {
    directories.push(parts.slice(0, index + 1).join("/"));
  }

  return directories;
}

function sortDirectoriesBottomUp(directories: string[]): string[] {
  return [...new Set(directories)].sort((left, right) => {
    const leftDepth = left.split("/").length;
    const rightDepth = right.split("/").length;
    return rightDepth - leftDepth || left.localeCompare(right);
  });
}

function getBarrelExportEntries(
  directory: string,
  compiledSchemas: CompiledSchema[],
): string[] {
  const entries = new Set<string>();
  const dirPrefix = directory ? `${directory}/` : "";

  for (const schema of compiledSchemas) {
    if (directory && !schema.pathId.startsWith(dirPrefix)) {
      continue;
    }

    const relativeToDirectory = directory
      ? schema.pathId.slice(dirPrefix.length)
      : schema.pathId;
    const segments = relativeToDirectory.split("/");
    const firstSegment = segments[0];
    if (!firstSegment) {
      continue;
    }

    if (segments.length === 1) {
      entries.add(`./${firstSegment}.raw`);
      entries.add(`./${firstSegment}.zod`);
    } else {
      entries.add(`./${firstSegment}`);
    }
  }

  return [...entries].sort((left, right) => left.localeCompare(right));
}

function buildZodLookupEntries(
  compiledSchemas: CompiledSchema[],
): ZodLookupEntry[] {
  const entries: ZodLookupEntry[] = [];

  for (const schema of compiledSchemas) {
    const importPath = `./${schema.pathId}.zod`.replace(/\\/g, "/");

    if (!schema.isDefsOnly) {
      entries.push({
        pathId: schema.pathId,
        zodExport: schema.zodExport,
        importPath,
        id: schema.id,
      });
    }

    for (const def of schema.defs) {
      entries.push({
        pathId: def.pathId,
        zodExport: def.zodExport,
        importPath,
        id: def.id,
      });
    }
  }

  return entries.sort((left, right) => left.pathId.localeCompare(right.pathId));
}

function buildRawLookupEntries(
  compiledSchemas: CompiledSchema[],
): RawLookupEntry[] {
  return compiledSchemas
    .map((schema) => ({
      pathId: schema.pathId,
      rawExport: schema.rawExport,
      importPath: `./${schema.pathId}.raw`.replace(/\\/g, "/"),
      id: schema.id,
    }))
    .sort((left, right) => left.pathId.localeCompare(right.pathId));
}

async function loadCompileHelperSource(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "runtime/compile-json-schema.ts"),
    join(here, "../src/runtime/compile-json-schema.ts"),
    join(here, "../runtime/compile-json-schema.ts"),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // try next
    }
  }

  throw new Error(
    "Could not locate runtime/compile-json-schema.ts to emit _compile.ts",
  );
}

export async function generateSchemas(
  options: GenerateOptions = {},
): Promise<ZodforgeManifest> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = resolve(cwd, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const cleanBeforeGenerate = options.cleanBeforeGenerate ?? true;

  if (cleanBeforeGenerate) {
    await wipeOutputDirectory(outputDir);
  }

  const resolvedFiles = await resolveSchemaFiles({
    path: options.path,
    cwd,
    schemasDir: options.schemasDir,
    pathPrefix: options.pathPrefix,
    suffix: options.suffix,
  });

  const loaded = await loadSchemas({ files: resolvedFiles });

  const compiledSchemas = compileLoadedSchemas(loaded, {
    naming: options.naming,
    register: false,
  });

  assertUniqueIdentifiers(compiledSchemas);

  const generatedFiles: string[] = [];

  const needsCompileHelper = compiledSchemas.some(
    (schema) => schema.hasExternalRefs,
  );
  if (needsCompileHelper) {
    const helperSource = await loadCompileHelperSource();
    const compileRelativePath = "_compile.ts";
    await writeGeneratedFile(
      join(outputDir, compileRelativePath),
      renderCompileHelperFile(helperSource),
    );
    generatedFiles.push(compileRelativePath);
  }

  for (const compiled of compiledSchemas) {
    const rawOutputAbsolutePath = join(outputDir, compiled.rawOutputRelativePath);
    const jsonImportPath = computeJsonImportPath(
      rawOutputAbsolutePath,
      compiled.sourcePath,
    );
    await writeGeneratedFile(
      rawOutputAbsolutePath,
      renderRawFile(compiled, jsonImportPath),
    );
    generatedFiles.push(compiled.rawOutputRelativePath);

    const zodOutputAbsolutePath = join(outputDir, compiled.zodOutputRelativePath);
    await writeGeneratedFile(
      zodOutputAbsolutePath,
      renderZodFile(compiled),
    );
    generatedFiles.push(compiled.zodOutputRelativePath);
  }

  const directories = sortDirectoriesBottomUp(
    compiledSchemas.flatMap((schema) => collectDirectoriesForPath(schema.pathId)),
  );

  for (const directory of directories) {
    const children = getBarrelExportEntries(directory, compiledSchemas);
    const barrelRelativePath = join(directory, "index.ts").replace(/\\/g, "/");
    await writeGeneratedFile(
      join(outputDir, barrelRelativePath),
      renderBarrelFile(children),
    );
    generatedFiles.push(barrelRelativePath);
  }

  const zodLookupRelativePath = "_lookup.zod.ts";
  await writeGeneratedFile(
    join(outputDir, zodLookupRelativePath),
    renderZodLookupFile(buildZodLookupEntries(compiledSchemas)),
  );
  generatedFiles.push(zodLookupRelativePath);

  const rawLookupRelativePath = "_lookup.raw.ts";
  await writeGeneratedFile(
    join(outputDir, rawLookupRelativePath),
    renderRawLookupFile(buildRawLookupEntries(compiledSchemas)),
  );
  generatedFiles.push(rawLookupRelativePath);

  const topLevelEntries = getBarrelExportEntries("", compiledSchemas);
  const rootIndexRelativePath = "index.ts";
  await writeGeneratedFile(
    join(outputDir, rootIndexRelativePath),
    renderRootIndexFile(topLevelEntries),
  );
  generatedFiles.push(rootIndexRelativePath);

  const manifest: ZodforgeManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outputDir: relative(cwd, outputDir).replace(/\\/g, "/") || ".",
    files: [...generatedFiles].sort((left, right) => left.localeCompare(right)),
  };

  await writeGeneratedFile(
    join(outputDir, MANIFEST_FILENAME),
    renderManifestFile(manifest),
  );

  return manifest;
}
