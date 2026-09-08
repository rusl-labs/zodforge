import { dirname } from "node:path";
import type { CompiledSchema, ResolvedSchemaFile } from "./types.js";

function duplicateKeyError(
  key: string,
  value: string,
  first: string,
  second: string,
): Error {
  return new Error(`Duplicate ${key} "${value}" from ${first} and ${second}`);
}

function claim(
  seen: Map<string, string>,
  key: string,
  value: string,
  source: string,
  uniquenessKey: string = value,
): void {
  const existing = seen.get(uniquenessKey);
  if (existing) {
    throw duplicateKeyError(key, value, existing, source);
  }
  seen.set(uniquenessKey, source);
}

function sourceLabel(file: ResolvedSchemaFile): string {
  return file.relativePath || file.absolutePath;
}

/**
 * Reject stem/pathId collisions on resolved files before compile can collapse
 * them into a single document (which then looks like a self-duplicate $id).
 */
export function assertUniqueResolvedFiles(files: ResolvedSchemaFile[]): void {
  const stems = new Map<string, string>();
  const pathIds = new Map<string, string>();

  for (const file of files) {
    const source = sourceLabel(file);
    const parent = dirname(file.relativePath).replace(/\\/g, "/");
    claim(stems, "stem", file.stem, source, `${parent}/${file.stem}`);
    claim(pathIds, "pathId", file.pathId, source);
  }
}

export function indexByUniquePathId<
  T extends { pathId: string; absolutePath: string },
>(entries: T[]): Map<string, T> {
  const byPathId = new Map<string, T>();

  for (const entry of entries) {
    const existing = byPathId.get(entry.pathId);
    if (existing) {
      throw duplicateKeyError(
        "pathId",
        entry.pathId,
        existing.absolutePath,
        entry.absolutePath,
      );
    }
    byPathId.set(entry.pathId, entry);
  }

  return byPathId;
}

export function assertUniqueIdentifiers(schemas: CompiledSchema[]): void {
  const ids = new Map<string, string>();
  const paths = new Map<string, string>();
  const exportNames = new Map<string, string>();

  for (const schema of schemas) {
    if (schema.id) {
      claim(ids, "$id", schema.id, schema.sourcePath);
    }
    claim(paths, "pathId", schema.pathId, schema.sourcePath);
    claim(exportNames, "export", schema.rawExport, schema.sourcePath);

    if (!schema.isDefsOnly) {
      claim(exportNames, "export", schema.zodExport, schema.sourcePath);
    }

    for (const def of schema.defs) {
      claim(paths, "def pathId", def.pathId, schema.sourcePath);
      claim(exportNames, "def export", def.zodExport, schema.sourcePath);
    }
  }
}
