import { dirname, join, relative, resolve } from "node:path";
import { compileSchemaFile, computeJsonImportPath } from "./compile.js";
import { wipeOutputDirectory, writeGeneratedFile } from "./fs.js";
import { resolveSchemaFiles } from "./resolve.js";
import {
  renderBarrelFile,
  renderLookupFile,
  renderManifestFile,
  renderRootIndexFile,
  renderSchemaFile,
} from "./templates.js";
import {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_SCHEMAS_DIR,
  MANIFEST_FILENAME,
  type CompiledSchema,
  type GenerateOptions,
  type ZodforgeManifest,
} from "./types.js";

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
    const firstSegment = relativeToDirectory.split("/")[0];
    if (firstSegment) {
      entries.add(`./${firstSegment}`);
    }
  }

  return [...entries].sort((left, right) => left.localeCompare(right));
}

function assertUniqueIdentifiers(schemas: CompiledSchema[]): void {
  const ids = new Map<string, string>();
  const paths = new Map<string, string>();

  for (const schema of schemas) {
    if (schema.id) {
      const existing = ids.get(schema.id);
      if (existing) {
        throw new Error(
          `Duplicate $id "${schema.id}" in ${schema.sourcePath} and ${existing}`,
        );
      }
      ids.set(schema.id, schema.sourcePath);
    }

    const existingPath = paths.get(schema.pathId);
    if (existingPath) {
      throw new Error(
        `Duplicate pathId "${schema.pathId}" in ${schema.sourcePath} and ${existingPath}`,
      );
    }
    paths.set(schema.pathId, schema.sourcePath);
  }
}

export async function generateSchemas(
  options: GenerateOptions = {},
): Promise<ZodforgeManifest> {
  const cwd = options.cwd ?? process.cwd();
  const schemasDir = resolve(cwd, options.schemasDir ?? DEFAULT_SCHEMAS_DIR);
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
  });

  const compiledSchemas: CompiledSchema[] = [];

  for (const file of resolvedFiles) {
    const compiled = await compileSchemaFile(file.absolutePath, {
      schemasDir,
      pathPrefix: options.pathPrefix,
      register: false,
    });
    compiledSchemas.push(compiled);
  }

  assertUniqueIdentifiers(compiledSchemas);

  const generatedFiles: string[] = [];

  for (const compiled of compiledSchemas) {
    const outputAbsolutePath = join(outputDir, compiled.outputRelativePath);
    const jsonImportPath = computeJsonImportPath(
      outputAbsolutePath,
      compiled.sourcePath,
    );
    await writeGeneratedFile(
      outputAbsolutePath,
      renderSchemaFile(compiled, jsonImportPath),
    );
    generatedFiles.push(compiled.outputRelativePath);
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

  const lookupRelativePath = "_lookup.ts";
  await writeGeneratedFile(
    join(outputDir, lookupRelativePath),
    renderLookupFile(compiledSchemas),
  );
  generatedFiles.push(lookupRelativePath);

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
