import { dirname, relative, resolve as resolvePath } from "node:path";
import type { JsonSchemaDocument } from "./types.js";
import {
  defDocumentId,
  defPathId,
  nameBase,
  zodDefExportName,
  zodExportName,
  type NamingMode,
  DEFAULT_NAMING_MODE,
} from "./naming.js";
import { collectExternalRefs } from "./runtime/compile-json-schema.js";
import { isDefsOnlyDocument } from "./compile-helpers.js";

export interface RegistryDocument {
  json: JsonSchemaDocument;
  absolutePath: string;
  pathId: string;
  stem: string;
}

export interface ExportTarget {
  /** pathId of the document that owns the export */
  pathId: string;
  absolutePath: string;
  /** Generated Zod export binding name */
  zodExport: string;
  /** Lookup key for byPath / meta */
  exportPathId: string;
  id?: string;
  kind: "root" | "def";
  defKey?: string;
}

/**
 * Rusl `$id` values often include `/schemas/` before the schema slug, while
 * `$ref` URIs omit it. Index both forms when present.
 */
export function idAliases(id: string): string[] {
  const aliases = [id];
  const withoutSchemas = id.replace(/\/schemas\/([^/]+)$/, "/$1");
  if (withoutSchemas !== id) {
    aliases.push(withoutSchemas);
  }
  return aliases;
}

export function parseSchemaRef(ref: string): { base: string; pointer: string } {
  const hashIndex = ref.indexOf("#");
  if (hashIndex === -1) {
    return { base: ref, pointer: "" };
  }
  if (hashIndex === 0) {
    return { base: "", pointer: ref.slice(1) };
  }
  return {
    base: ref.slice(0, hashIndex),
    pointer: ref.slice(hashIndex + 1),
  };
}

function unescapeJsonPointer(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function getByPointer(document: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") {
    return document;
  }

  const normalized = pointer.startsWith("/") ? pointer : `/${pointer}`;
  const parts = normalized
    .split("/")
    .slice(1)
    .filter((part) => part.length > 0)
    .map(unescapeJsonPointer);

  let current: unknown = document;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function buildDocumentRegistry(
  documents: RegistryDocument[],
): Map<string, RegistryDocument> {
  const registry = new Map<string, RegistryDocument>();

  for (const entry of documents) {
    registry.set(entry.absolutePath, entry);

    const id = entry.json.$id;
    if (typeof id === "string" && id.length > 0) {
      for (const alias of idAliases(id)) {
        registry.set(alias, entry);
      }
    }
  }

  return registry;
}

function resolveRegistryEntry(
  base: string,
  registry: Map<string, RegistryDocument>,
  fromAbsolutePath?: string,
): RegistryDocument | undefined {
  const direct = registry.get(base);
  if (direct) {
    return direct;
  }

  if (
    fromAbsolutePath &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(base) &&
    (base.startsWith(".") || base.startsWith("/") || !base.includes(":"))
  ) {
    const resolved = resolvePath(dirname(fromAbsolutePath), base);
    return registry.get(resolved);
  }

  return undefined;
}

function getDefsSegment(
  json: JsonSchemaDocument,
): "$defs" | "definitions" {
  if (json.$defs) {
    return "$defs";
  }
  if (json.definitions) {
    return "definitions";
  }
  return "$defs";
}

function getDefKeys(json: JsonSchemaDocument): string[] {
  const defs = json.$defs ?? json.definitions;
  if (!defs || typeof defs !== "object") {
    return [];
  }
  return Object.keys(defs);
}

/**
 * Build a catalog of every exportable Zod binding, keyed by absolute `$ref`
 * forms that should resolve to it (including Rusl `$id` aliases).
 */
export function buildExportCatalog(
  documents: RegistryDocument[],
  naming: NamingMode = DEFAULT_NAMING_MODE,
): Map<string, ExportTarget> {
  const catalog = new Map<string, ExportTarget>();

  for (const entry of documents) {
    const exportBase = nameBase(entry.pathId, entry.stem, naming);
    const defsSegment = getDefsSegment(entry.json);
    const defsOnly = isDefsOnlyDocument(entry.json);

    const register = (key: string, target: ExportTarget): void => {
      catalog.set(key, target);
    };

    const idKeys =
      typeof entry.json.$id === "string" && entry.json.$id.length > 0
        ? idAliases(entry.json.$id)
        : [];

    if (!defsOnly) {
      const rootTarget: ExportTarget = {
        pathId: entry.pathId,
        absolutePath: entry.absolutePath,
        zodExport: zodExportName(exportBase),
        exportPathId: entry.pathId,
        id: entry.json.$id,
        kind: "root",
      };
      for (const id of idKeys) {
        register(id, rootTarget);
      }
    }

    for (const defKey of getDefKeys(entry.json)) {
      const defTarget: ExportTarget = {
        pathId: entry.pathId,
        absolutePath: entry.absolutePath,
        zodExport: zodDefExportName(exportBase, defKey),
        exportPathId: defPathId(entry.pathId, defKey, defsSegment),
        id: entry.json.$id
          ? defDocumentId(entry.json.$id, defKey, defsSegment)
          : undefined,
        kind: "def",
        defKey,
      };

      for (const id of idKeys) {
        register(`${id}#/${defsSegment}/${defKey}`, defTarget);
        // Prefer $defs form even if document used definitions, for ref flexibility
        if (defsSegment !== "$defs") {
          register(`${id}#/$defs/${defKey}`, defTarget);
        }
      }
    }
  }

  return catalog;
}

export function resolveExternalRef(
  ref: string,
  registry: Map<string, RegistryDocument>,
  catalog: Map<string, ExportTarget>,
  fromAbsolutePath?: string,
): ExportTarget {
  const direct = catalog.get(ref);
  if (direct) {
    return direct;
  }

  const { base, pointer } = parseSchemaRef(ref);
  const entry = resolveRegistryEntry(base, registry, fromAbsolutePath);
  if (!entry) {
    throw new Error(
      `Unresolved external $ref "${ref}". Include the referenced schema in the generate path and ensure its $id matches the ref base URI.`,
    );
  }

  // Rebuild candidate keys using the entry's actual $id aliases + pointer
  const defsSegment = getDefsSegment(entry.json);
  const pointerParts = pointer
    .split("/")
    .filter(Boolean)
    .map(unescapeJsonPointer);

  if (pointerParts.length === 0) {
    if (isDefsOnlyDocument(entry.json)) {
      throw new Error(
        `External $ref "${ref}" points at defs-only document ${entry.pathId}; use a #/$defs/... fragment.`,
      );
    }
    if (entry.json.$id) {
      for (const id of idAliases(entry.json.$id)) {
        const target = catalog.get(id);
        if (target) {
          return target;
        }
      }
    }
    throw new Error(`No root Zod export for $ref "${ref}" (${entry.pathId})`);
  }

  if (
    pointerParts.length === 2 &&
    (pointerParts[0] === "$defs" || pointerParts[0] === "definitions")
  ) {
    const defKey = pointerParts[1]!;
    if (entry.json.$id) {
      for (const id of idAliases(entry.json.$id)) {
        const target =
          catalog.get(`${id}#/${pointerParts[0]}/${defKey}`) ??
          catalog.get(`${id}#/${defsSegment}/${defKey}`) ??
          catalog.get(`${id}#/$defs/${defKey}`);
        if (target) {
          return target;
        }
      }
    }
    throw new Error(
      `External $ref "${ref}" pointer not found as an export on ${entry.pathId}`,
    );
  }

  throw new Error(
    `Unsupported external $ref pointer in "${ref}" (only #/$defs/<key> is supported)`,
  );
}

/** External refs used by a document, resolved to export targets. */
export function resolveDocumentExternalDeps(
  entry: RegistryDocument,
  registry: Map<string, RegistryDocument>,
  catalog: Map<string, ExportTarget>,
): Array<{ ref: string; target: ExportTarget }> {
  const refs = collectExternalRefs(entry.json);
  return refs.map((ref) => ({
    ref,
    target: resolveExternalRef(ref, registry, catalog, entry.absolutePath),
  }));
}

/** Relative import path from one generated zod module to another. */
export function zodSiblingImportPath(
  fromPathId: string,
  toPathId: string,
): string {
  const fromDir = dirname(fromPathId);
  const toModule = `${toPathId}.zod`;
  let rel = relative(fromDir === "." ? "" : fromDir, toModule).replace(
    /\\/g,
    "/",
  );
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return rel;
}

/** Relative import path from a generated zod module to `_compile`. */
export function compileHelperImportPath(pathId: string): string {
  const dirDepth = pathId.split("/").length - 1;
  if (dirDepth <= 0) {
    return "./_compile";
  }
  return `${"../".repeat(dirDepth)}_compile`;
}
