import { resolve } from "node:path";
import { compileLoadedSchemas, loadSchemas } from "./compile.js";
import { resolveSchemaFiles } from "./resolve.js";
import {
  DEFAULT_SCHEMAS_DIR,
  type CompiledSchema,
  type ForgeOptions,
  type ForgeResult,
} from "./types.js";

function assertUniqueIdentifiers(schemas: CompiledSchema[]): void {
  const ids = new Map<string, string>();
  const paths = new Map<string, string>();
  const exportNames = new Map<string, string>();

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

    const existingRawExport = exportNames.get(schema.rawExport);
    if (existingRawExport) {
      throw new Error(
        `Duplicate export "${schema.rawExport}" in ${schema.sourcePath} and ${existingRawExport}`,
      );
    }
    exportNames.set(schema.rawExport, schema.sourcePath);

    if (!schema.isDefsOnly) {
      const existingZodExport = exportNames.get(schema.zodExport);
      if (existingZodExport) {
        throw new Error(
          `Duplicate export "${schema.zodExport}" in ${schema.sourcePath} and ${existingZodExport}`,
        );
      }
      exportNames.set(schema.zodExport, schema.sourcePath);
    }

    for (const def of schema.defs) {
      const existingDefPath = paths.get(def.pathId);
      if (existingDefPath) {
        throw new Error(
          `Duplicate def pathId "${def.pathId}" in ${schema.sourcePath} and ${existingDefPath}`,
        );
      }
      paths.set(def.pathId, schema.sourcePath);

      const existingDefExport = exportNames.get(def.zodExport);
      if (existingDefExport) {
        throw new Error(
          `Duplicate def export "${def.zodExport}" in ${schema.sourcePath} and ${existingDefExport}`,
        );
      }
      exportNames.set(def.zodExport, schema.sourcePath);
    }
  }
}

export async function forgeSchemas(
  options: ForgeOptions = {},
): Promise<ForgeResult> {
  const cwd = options.cwd ?? process.cwd();
  const schemasDir = resolve(cwd, options.schemasDir ?? DEFAULT_SCHEMAS_DIR);
  const resolvedFiles = await resolveSchemaFiles({
    path: options.path,
    cwd,
    schemasDir: options.schemasDir,
    pathPrefix: options.pathPrefix,
  });

  const loaded = await loadSchemas({ files: resolvedFiles });
  const compiledSchemas = compileLoadedSchemas(loaded, {
    naming: options.naming,
    register: options.register,
  });

  assertUniqueIdentifiers(compiledSchemas);

  const result: ForgeResult = {
    byId: {},
    byPath: {},
    rawByPath: {},
    rawById: {},
  };

  for (const compiled of compiledSchemas) {
    result[compiled.rawExport] = compiled.rawJson;
    result.rawByPath[compiled.pathId] = compiled.rawJson;
    if (compiled.id) {
      result.rawById[compiled.id] = compiled.rawJson;
    }

    if (!compiled.isDefsOnly) {
      result[compiled.zodExport] = compiled.schema;
      result.byPath[compiled.pathId] = compiled.schema;
      if (compiled.id) {
        result.byId[compiled.id] = compiled.schema;
      }
    }

    for (const def of compiled.defs) {
      result[def.zodExport] = def.schema;
      result.byPath[def.pathId] = def.schema;
      if (def.id) {
        result.byId[def.id] = def.schema;
      }
    }
  }

  return result;
}
