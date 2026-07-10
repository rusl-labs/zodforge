import { z, type ZodType } from "zod";
import { dirname, relative } from "node:path";
import { getDefKeys, isDefsOnlyDocument } from "./compile-helpers.js";
import { readJsonFile } from "./fs.js";
import {
  DEFAULT_NAMING_MODE,
  defDocumentId,
  defPathId,
  defTypeExportName,
  defTypeInputExportName,
  jsonImportVarName,
  nameBase,
  rawExportName,
  rawTypeExportName,
  stemFromFilename,
  typeExportName,
  typeInputExportName,
  zodDefExportName,
  zodExportName,
  type NamingMode,
} from "./naming.js";
import { computeOutputRelativePath, computePathId } from "./resolve.js";
import {
  buildDocumentRegistry,
  buildExportCatalog,
  resolveDocumentExternalDeps,
  type ExportTarget,
  type RegistryDocument,
} from "./refs.js";
import {
  collectExternalRefs,
  compileJsonSchema,
} from "./runtime/compile-json-schema.js";
import type {
  CompiledDef,
  CompiledSchema,
  ExternalZodDep,
  JsonSchemaDocument,
} from "./types.js";

export { hasRootValidator, isDefsOnlyDocument } from "./compile-helpers.js";

export interface CompileOptions {
  schemasDir: string;
  pathPrefix?: string;
  naming?: NamingMode;
  register?: boolean;
}

export interface LoadedSchema extends RegistryDocument {}

function getDefsSegment(json: JsonSchemaDocument): "$defs" | "definitions" {
  if (json.$defs) {
    return "$defs";
  }
  if (json.definitions) {
    return "definitions";
  }
  return "$defs";
}

function pickExport(
  compiled: CompiledSchema,
  target: ExportTarget,
): ZodType {
  if (target.kind === "root") {
    return compiled.schema;
  }
  const def = compiled.defs.find((item) => item.defKey === target.defKey);
  if (!def) {
    throw new Error(
      `Missing def export "${target.defKey}" on ${target.pathId}`,
    );
  }
  return def.schema;
}

function compileDefSchema(
  rawJson: JsonSchemaDocument,
  defKey: string,
  defsSegment: "$defs" | "definitions",
  external: Record<string, ZodType>,
): ZodType {
  const defDocument: JsonSchemaDocument = {
    ...rawJson,
    $ref: `#/${defsSegment}/${defKey}`,
  };
  return compileJsonSchema(defDocument, { external });
}

/**
 * Compile every loaded schema, resolving external `$ref`s to sibling Zod
 * exports (import composition). Dependencies are compiled first; document
 * cycles use `z.lazy` so mutual refs work.
 */
export function compileLoadedSchemas(
  loaded: LoadedSchema[],
  options: {
    naming?: NamingMode;
    register?: boolean;
  } = {},
): CompiledSchema[] {
  const naming = options.naming ?? DEFAULT_NAMING_MODE;
  const register = options.register !== false;
  const registry = buildDocumentRegistry(loaded);
  const catalog = buildExportCatalog(loaded, naming);
  const byPathId = new Map(loaded.map((entry) => [entry.pathId, entry]));

  const cache = new Map<string, CompiledSchema>();
  const inProgress = new Set<string>();

  function resolveZodExport(target: ExportTarget): ZodType {
    const cached = cache.get(target.pathId);
    if (cached) {
      return pickExport(cached, target);
    }

    // Dependency still compiling (cycle) — defer until cache is populated.
    if (inProgress.has(target.pathId)) {
      return z.lazy(() => {
        const compiled = cache.get(target.pathId);
        if (!compiled) {
          throw new Error(
            `Circular $ref to "${target.pathId}" did not finish compiling`,
          );
        }
        return pickExport(compiled, target);
      });
    }

    return pickExport(ensureCompiled(target.pathId), target);
  }

  function ensureCompiled(pathId: string): CompiledSchema {
    const cached = cache.get(pathId);
    if (cached) {
      return cached;
    }
    if (inProgress.has(pathId)) {
      throw new Error(
        `Re-entrant compile for "${pathId}" without lazy resolution`,
      );
    }

    const entry = byPathId.get(pathId);
    if (!entry) {
      throw new Error(`Unknown schema pathId "${pathId}"`);
    }

    inProgress.add(pathId);
    const compiled = compileOne(entry);
    cache.set(pathId, compiled);
    inProgress.delete(pathId);
    return compiled;
  }

  function compileOne(entry: LoadedSchema): CompiledSchema {
    const exportBase = nameBase(entry.pathId, entry.stem, naming);
    const rawExport = rawExportName(exportBase);
    const rawTypeExport = rawTypeExportName(exportBase);
    const zodExport = zodExportName(exportBase);
    const typeExport = typeExportName(exportBase);
    const typeInputExport = typeInputExportName(exportBase);
    const jsonImportVar = jsonImportVarName(entry.stem);
    const defsSegment = getDefsSegment(entry.json);
    const isDefsOnly = isDefsOnlyDocument(entry.json);

    const depPairs = resolveDocumentExternalDeps(entry, registry, catalog);

    const external: Record<string, ZodType> = {};
    for (const { ref, target } of depPairs) {
      external[ref] = resolveZodExport(target);
    }

    const externalDeps: ExternalZodDep[] = depPairs.map(({ ref, target }) => ({
      ref,
      pathId: target.pathId,
      zodExport: target.zodExport,
    }));

    // De-dupe deps by export for imports (same module may satisfy multiple refs).
    const uniqueDeps = new Map<string, ExternalZodDep>();
    for (const dep of externalDeps) {
      uniqueDeps.set(`${dep.pathId}::${dep.zodExport}`, dep);
    }

    let schema: ZodType = compileJsonSchema(entry.json, { external });

    const meta = {
      id: entry.json.$id,
      title: entry.json.title,
      description: entry.json.description,
      pathId: entry.pathId,
    };

    if (register && !isDefsOnly) {
      schema = schema.meta(meta);
    }

    const defs: CompiledDef[] = getDefKeys(entry.json).map((defKey) => {
      let defSchema = compileDefSchema(
        entry.json,
        defKey,
        defsSegment,
        external,
      );
      const defJson = (entry.json.$defs ?? entry.json.definitions)?.[defKey];
      const defPath = defPathId(entry.pathId, defKey, defsSegment);
      const defId = entry.json.$id
        ? defDocumentId(entry.json.$id, defKey, defsSegment)
        : undefined;

      if (register) {
        defSchema = defSchema.meta({
          id: defId,
          pathId: defPath,
          title: defJson?.title,
          description: defJson?.description,
        });
      }

      return {
        defKey,
        refPath: `#/${defsSegment}/${defKey}`,
        pathId: defPath,
        id: defId,
        schema: defSchema,
        zodExport: zodDefExportName(exportBase, defKey),
        typeExport: defTypeExportName(exportBase, defKey),
        typeInputExport: defTypeInputExportName(exportBase, defKey),
        title: defJson?.title,
        description: defJson?.description,
      };
    });

    return {
      schema,
      pathId: entry.pathId,
      stem: entry.stem,
      rawExport,
      rawTypeExport,
      zodExport,
      typeExport,
      typeInputExport,
      jsonImportVar,
      jsonImportPath: entry.absolutePath,
      sourcePath: entry.absolutePath,
      rawOutputRelativePath: computeOutputRelativePath(entry.pathId, "raw"),
      zodOutputRelativePath: computeOutputRelativePath(entry.pathId, "zod"),
      rawJson: entry.json,
      id: entry.json.$id,
      title: entry.json.title,
      description: entry.json.description,
      defs,
      isDefsOnly,
      externalDeps: [...uniqueDeps.values()].sort((left, right) =>
        left.zodExport.localeCompare(right.zodExport),
      ),
      hasExternalRefs: collectExternalRefs(entry.json).length > 0,
    };
  }

  // Compile all documents (order via ensureCompiled dependency chase).
  for (const entry of loaded) {
    ensureCompiled(entry.pathId);
  }

  return loaded.map((entry) => cache.get(entry.pathId)!);
}

export function compileSchemaFromJson(
  json: JsonSchemaDocument,
  metadata: {
    absolutePath: string;
    schemasDir: string;
    pathPrefix?: string;
    naming?: NamingMode;
    register?: boolean;
  },
): CompiledSchema {
  const stem = stemFromFilename(metadata.absolutePath);
  const pathId = computePathId(
    metadata.absolutePath,
    metadata.schemasDir,
    metadata.pathPrefix,
  );

  const [compiled] = compileLoadedSchemas(
    [
      {
        json,
        absolutePath: metadata.absolutePath,
        pathId,
        stem,
      },
    ],
    {
      naming: metadata.naming,
      register: metadata.register,
    },
  );

  if (!compiled) {
    throw new Error(`Failed to compile ${metadata.absolutePath}`);
  }
  return compiled;
}

export async function compileSchemaFile(
  absolutePath: string,
  options: CompileOptions,
): Promise<CompiledSchema> {
  const json = await readJsonFile<JsonSchemaDocument>(absolutePath);
  return compileSchemaFromJson(json, {
    absolutePath,
    schemasDir: options.schemasDir,
    pathPrefix: options.pathPrefix,
    naming: options.naming,
    register: options.register,
  });
}

export function computeJsonImportPath(
  outputAbsolutePath: string,
  sourceAbsolutePath: string,
): string {
  const importPath = relative(
    dirname(outputAbsolutePath),
    sourceAbsolutePath,
  ).replace(/\\/g, "/");

  return importPath.startsWith(".") ? importPath : `./${importPath}`;
}

export async function loadSchemas(options: {
  files: Array<{ absolutePath: string; pathId: string; stem: string }>;
}): Promise<LoadedSchema[]> {
  return Promise.all(
    options.files.map(async (file) => ({
      absolutePath: file.absolutePath,
      pathId: file.pathId,
      stem: file.stem,
      json: await readJsonFile<JsonSchemaDocument>(file.absolutePath),
    })),
  );
}
