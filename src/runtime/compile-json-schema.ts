/**
 * JSON Schema → Zod compiler with external $ref support.
 *
 * Zod's `fromJSONSchema` only accepts local `#/$defs/...` refs. This compiler
 * resolves external refs (Rusl/HTTP URIs, etc.) via an injected map of already
 * built Zod schemas — so generated modules can import sibling validators
 * instead of inlining copies.
 *
 * Self-contained (only imports `zod`) so generate can copy this file into the
 * output tree as `_compile.ts`.
 *
 * When `oneOf` / `anyOf` / `allOf` sit beside `type`, `properties`, `required`,
 * etc., both the applicator and the sibling constraints are compiled and
 * intersected. Returning the applicator alone would drop the siblings — and
 * that path is the one used whenever a subtree contains an external `$ref`.
 */
import { fromJSONSchema } from "zod";
import * as z from "zod";
import type { ZodType } from "zod";

export type JsonSchema = Record<string, unknown> | boolean;

export type ExternalRefMap =
  | Record<string, ZodType>
  | Map<string, ZodType>
  | ((ref: string) => ZodType | undefined);

export interface CompileJsonSchemaOptions {
  /**
   * Map of absolute `$ref` strings (including fragment) to Zod schemas.
   * Example key: `https://resources.rusl.com/resources/pragmatic/geo#/$defs/point`
   */
  external?: ExternalRefMap;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unescapeJsonPointer(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function lookupExternal(
  ref: string,
  external: ExternalRefMap | undefined,
): ZodType | undefined {
  if (!external) {
    return undefined;
  }
  if (typeof external === "function") {
    return external(ref);
  }
  if (external instanceof Map) {
    return external.get(ref);
  }
  return external[ref];
}

function containsRef(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(containsRef);
  }
  if (!isPlainObject(node)) {
    return false;
  }
  if (typeof node.$ref === "string") {
    return true;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$defs" || key === "definitions") {
      continue;
    }
    if (containsRef(value)) {
      return true;
    }
  }
  return false;
}

function parseLocalDefRef(
  ref: string,
): { segment: "$defs" | "definitions"; key: string } | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const parts = ref
    .slice(2)
    .split("/")
    .filter(Boolean)
    .map(unescapeJsonPointer);
  if (
    parts.length === 2 &&
    (parts[0] === "$defs" || parts[0] === "definitions") &&
    typeof parts[1] === "string"
  ) {
    return {
      segment: parts[0] as "$defs" | "definitions",
      key: parts[1],
    };
  }
  return undefined;
}

function asJsonSchemaInput(
  node: unknown,
): Parameters<typeof fromJSONSchema>[0] {
  return node as Parameters<typeof fromJSONSchema>[0];
}

/** JSON Schema keywords that constrain the instance (not annotations / applicators). */
const SIBLING_CONSTRAINT_KEYS = new Set([
  "$ref",
  "$dynamicRef",
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "dependentSchemas",
  "dependentRequired",
  "items",
  "prefixItems",
  "contains",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minContains",
  "maxContains",
  "unevaluatedItems",
  "minProperties",
  "maxProperties",
  "unevaluatedProperties",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "if",
  "then",
  "else",
  "not",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);

function hasSiblingConstraints(node: Record<string, unknown>): boolean {
  return Object.keys(node).some((key) => SIBLING_CONSTRAINT_KEYS.has(key));
}

function hasApplicators(node: Record<string, unknown>): boolean {
  return (
    (Array.isArray(node.oneOf) && node.oneOf.length > 0) ||
    (Array.isArray(node.anyOf) && node.anyOf.length > 0) ||
    (Array.isArray(node.allOf) && node.allOf.length > 0)
  );
}

/** `required` keys that are not in `properties` — Zod's fromJSONSchema ignores these. */
function hasRequiredKeysOutsideProperties(
  node: Record<string, unknown>,
): boolean {
  if (!Array.isArray(node.required)) {
    return false;
  }
  const properties = isPlainObject(node.properties) ? node.properties : {};
  return node.required.some(
    (key) => typeof key === "string" && !(key in properties),
  );
}

function stripApplicators(
  node: Record<string, unknown>,
): Record<string, unknown> {
  const {
    oneOf: _oneOf,
    anyOf: _anyOf,
    allOf: _allOf,
    ...rest
  } = node;
  return rest;
}

function asUnion(options: ZodType[]): ZodType {
  return options.length === 1
    ? options[0]!
    : z.union(options as [ZodType, ZodType, ...ZodType[]]);
}

function intersectAll(parts: ZodType[]): ZodType {
  return parts.reduce((acc, part) => z.intersection(acc, part));
}

/**
 * Compile a JSON Schema document (or fragment) to a Zod schema.
 * External `$ref`s must be provided via `options.external`.
 */
export function compileJsonSchema(
  schema: JsonSchema,
  options: CompileJsonSchemaOptions = {},
): ZodType {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }

  const root = schema;
  const defsRecord = (root.$defs ?? root.definitions ?? {}) as Record<
    string,
    unknown
  >;
  const defsSegment: "$defs" | "definitions" = root.$defs
    ? "$defs"
    : root.definitions
      ? "definitions"
      : "$defs";

  const localDefs = new Map<string, ZodType>();
  const compilingLocals = new Set<string>();

  function resolveRef(ref: string): ZodType {
    const local = parseLocalDefRef(ref);
    if (local) {
      if (localDefs.has(local.key)) {
        return localDefs.get(local.key)!;
      }
      if (compilingLocals.has(local.key)) {
        return z.lazy(() => {
          const resolved = localDefs.get(local.key);
          if (!resolved) {
            throw new Error(`Circular local $ref not resolved: ${ref}`);
          }
          return resolved;
        });
      }
      return compileLocalDef(local.key);
    }

    // External — wrap in lazy so ESM circular imports between generated
    // modules evaluate safely.
    return z.lazy(() => {
      const resolved = lookupExternal(ref, options.external);
      if (!resolved) {
        throw new Error(
          `Unresolved external $ref "${ref}". Import the target Zod schema and pass it in compileJsonSchema({ external }).`,
        );
      }
      return resolved;
    });
  }

  function compileLocalDef(key: string): ZodType {
    const node = defsRecord[key];
    if (node === undefined) {
      throw new Error(`Local $ref "#/${defsSegment}/${key}" not found`);
    }
    compilingLocals.add(key);
    const compiled = compileNode(node);
    localDefs.set(key, compiled);
    compilingLocals.delete(key);
    return compiled;
  }

  function compileObject(node: Record<string, unknown>): ZodType {
    const properties = isPlainObject(node.properties)
      ? (node.properties as Record<string, unknown>)
      : {};
    const required = new Set(
      Array.isArray(node.required)
        ? node.required.filter((item): item is string => typeof item === "string")
        : [],
    );

    const shape: Record<string, ZodType> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      let propZod = compileNode(propSchema);
      if (!required.has(key)) {
        propZod = propZod.optional();
      }
      shape[key] = propZod;
    }

    for (const key of required) {
      if (shape[key] === undefined) {
        shape[key] = z.unknown();
      }
    }

    let objectSchema: z.ZodObject<Record<string, ZodType>> = z.object(shape);

    if (node.additionalProperties === false) {
      objectSchema = objectSchema.strict();
    } else if (
      node.additionalProperties !== undefined &&
      node.additionalProperties !== true
    ) {
      objectSchema = objectSchema.catchall(
        compileNode(node.additionalProperties),
      );
    }

    return objectSchema;
  }

  function compileArray(node: Record<string, unknown>): ZodType {
    if (Array.isArray(node.prefixItems)) {
      const items = node.prefixItems.map((item) => compileNode(item));
      let tuple = z.tuple(items as [ZodType, ...ZodType[]]);
      if (node.items === false) {
        return tuple;
      }
      if (node.items !== undefined && node.items !== true) {
        return tuple.rest(compileNode(node.items));
      }
      return tuple;
    }

    const items =
      node.items === undefined || node.items === true
        ? z.any()
        : node.items === false
          ? z.never()
          : compileNode(node.items);

    let arraySchema = z.array(items);
    if (typeof node.minItems === "number") {
      arraySchema = arraySchema.min(node.minItems);
    }
    if (typeof node.maxItems === "number") {
      arraySchema = arraySchema.max(node.maxItems);
    }
    return arraySchema;
  }

  function compileApplicators(
    node: Record<string, unknown>,
  ): ZodType | undefined {
    const parts: ZodType[] = [];

    if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
      parts.push(asUnion(node.oneOf.map((item) => compileNode(item))));
    }
    if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
      parts.push(asUnion(node.anyOf.map((item) => compileNode(item))));
    }
    if (Array.isArray(node.allOf) && node.allOf.length > 0) {
      parts.push(intersectAll(node.allOf.map((item) => compileNode(item))));
    }

    if (parts.length === 0) {
      return undefined;
    }
    return parts.length === 1 ? parts[0]! : intersectAll(parts);
  }

  function compileWithoutApplicators(node: Record<string, unknown>): ZodType {
    return compileNode(stripApplicators(node));
  }

  function compileNode(node: unknown): ZodType {
    if (typeof node === "boolean") {
      return node ? z.any() : z.never();
    }
    if (!isPlainObject(node)) {
      return fromJSONSchema(asJsonSchemaInput(node));
    }

    if (typeof node.$ref === "string") {
      return resolveRef(node.$ref);
    }

    // Self-contained nodes go through Zod unless we must compile locally:
    // applicators beside sibling constraints, or `required` keys that are not
    // in `properties` (fromJSONSchema treats those fragments as no-ops).
    if (
      !containsRef(node) &&
      !(hasApplicators(node) && hasSiblingConstraints(node)) &&
      !hasRequiredKeysOutsideProperties(node)
    ) {
      return fromJSONSchema(asJsonSchemaInput(node));
    }

    const applicator = compileApplicators(node);
    if (applicator) {
      if (!hasSiblingConstraints(node)) {
        return applicator;
      }
      return z.intersection(compileWithoutApplicators(node), applicator);
    }

    const types = Array.isArray(node.type)
      ? node.type
      : node.type !== undefined
        ? [node.type]
        : [];

    if (
      types.includes("object") ||
      node.properties !== undefined ||
      node.additionalProperties !== undefined ||
      node.required !== undefined
    ) {
      return compileObject(node);
    }

    if (
      types.includes("array") ||
      node.items !== undefined ||
      node.prefixItems !== undefined
    ) {
      return compileArray(node);
    }

    // Union type with nested refs, e.g. type: ["string", "null"]
    if (types.length > 1) {
      const variants = types.map((typeName) =>
        compileNode({ ...node, type: typeName }),
      );
      return z.union(variants as [ZodType, ZodType, ...ZodType[]]);
    }

    throw new Error(
      `Cannot compile JSON Schema node that contains $ref in an unsupported position: ${JSON.stringify(node).slice(0, 200)}`,
    );
  }

  // Materialize local defs first so mutual local refs resolve.
  for (const key of Object.keys(defsRecord).sort()) {
    if (!localDefs.has(key)) {
      compileLocalDef(key);
    }
  }

  // Root is only `$ref` / type / etc. — strip def bags before compiling body.
  const {
    $defs: _defs,
    definitions: _definitions,
    ...rootBody
  } = root;

  const hasRootShape =
    rootBody.$ref !== undefined ||
    rootBody.type !== undefined ||
    rootBody.const !== undefined ||
    rootBody.enum !== undefined ||
    rootBody.allOf !== undefined ||
    rootBody.anyOf !== undefined ||
    rootBody.oneOf !== undefined ||
    rootBody.properties !== undefined ||
    rootBody.items !== undefined ||
    rootBody.prefixItems !== undefined;

  if (!hasRootShape) {
    // Defs-only document — root is unused; return a never schema.
    return z.never();
  }

  return compileNode(rootBody);
}

/** Collect absolute (non-`#...`) `$ref` values under a schema node. */
export function collectExternalRefs(node: unknown): string[] {
  const found = new Set<string>();

  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) {
      found.add(value.$ref);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "$defs" || key === "definitions") {
        // Still walk defs — external refs often live there.
        walk(child);
        continue;
      }
      walk(child);
    }
  }

  walk(node);
  return [...found].sort();
}
