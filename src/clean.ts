import { dirname, join, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { deleteFile, pathExists, readJsonFile, removeEmptyDirectory } from "./fs.js";
import {
  DEFAULT_OUTPUT_DIR,
  MANIFEST_FILENAME,
  type CleanOptions,
  type ZodforgeManifest,
} from "./types.js";

async function removeDirectoryIfEmpty(
  directory: string,
  outputDir: string,
): Promise<void> {
  if (!directory.startsWith(outputDir) || directory === outputDir) {
    return;
  }

  try {
    const entries = await readdir(directory);
    if (entries.length === 0) {
      await removeEmptyDirectory(directory);
      await removeDirectoryIfEmpty(dirname(directory), outputDir);
    }
  } catch {
    // Directory may already be gone.
  }
}

async function removeEmptyDirectoriesFromManifest(
  manifest: ZodforgeManifest,
  outputDir: string,
): Promise<void> {
  const directories = [
    ...new Set(
      manifest.files
        .map((file) => dirname(join(outputDir, file)))
        .filter((directory) => directory.startsWith(outputDir)),
    ),
  ].sort((left, right) => right.length - left.length);

  for (const directory of directories) {
    await removeDirectoryIfEmpty(directory, outputDir);
  }
}

export async function cleanGeneratedSchemas(
  options: CleanOptions = {},
): Promise<{ removed: string[]; warned?: string }> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = resolve(cwd, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const manifestPath = join(outputDir, MANIFEST_FILENAME);
  const manifestExists = await pathExists(manifestPath);

  if (!manifestExists) {
    if (options.silent) {
      return { removed: [] };
    }

    return {
      removed: [],
      warned: `No manifest found at ${manifestPath}; nothing to clean.`,
    };
  }

  const manifest = await readJsonFile<ZodforgeManifest>(manifestPath);
  const removed: string[] = [];

  for (const file of manifest.files) {
    const absolutePath = join(outputDir, file);
    try {
      await deleteFile(absolutePath);
      removed.push(file);
    } catch {
      // Ignore missing files from prior partial cleans.
    }
  }

  try {
    await deleteFile(manifestPath);
    removed.push(MANIFEST_FILENAME);
  } catch {
    // Manifest may already be gone.
  }

  await removeEmptyDirectoriesFromManifest(manifest, outputDir);

  return { removed };
}
