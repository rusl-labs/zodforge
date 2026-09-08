import { resolve } from "node:path";
import { compileLoadedSchemas, loadSchemas } from "./compile.js";
import { resolveSchemaFiles } from "./resolve.js";
import {
  DEFAULT_SCHEMAS_DIR,
  type ForgeOptions,
  type ForgeResult,
} from "./types.js";
import { assertUniqueIdentifiers } from "./unique.js";

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
    suffix: options.suffix,
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
