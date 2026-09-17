import type { JsonSchemaDocument } from "./types.js";

export type DefsSegment = "$defs" | "definitions";

function getDefKeys(json: JsonSchemaDocument): string[] {
  const defs = json.$defs ?? json.definitions;
  if (!defs || typeof defs !== "object") {
    return [];
  }
  return Object.keys(defs);
}

export function getDefsSegment(json: JsonSchemaDocument): DefsSegment {
  if (json.$defs) {
    return "$defs";
  }
  if (json.definitions) {
    return "definitions";
  }
  return "$defs";
}

/**
 * Document used to compile a single `$defs` / `definitions` export.
 *
 * Only `$schema`, `$id`, the defs bag, and `$ref` are kept. Spreading the
 * root document beside `$ref` would apply the root's `anyOf` / `oneOf` /
 * `allOf` / `properties` as siblings, so a def the root applicator does
 * not admit can never validate (draft 2020-12 + Zod `fromJSONSchema`).
 */
export function defExportDocument(
  json: JsonSchemaDocument,
  defKey: string,
  defsSegment: DefsSegment = getDefsSegment(json),
): JsonSchemaDocument {
  const document: JsonSchemaDocument = {
    $ref: `#/${defsSegment}/${defKey}`,
  };

  if (json.$schema !== undefined) {
    document.$schema = json.$schema;
  }
  if (json.$id !== undefined) {
    document.$id = json.$id;
  }

  if (defsSegment === "definitions") {
    if (json.definitions) {
      document.definitions = json.definitions;
    }
  } else if (json.$defs) {
    document.$defs = json.$defs;
  }

  return document;
}

export function hasRootValidator(json: JsonSchemaDocument): boolean {
  if (json.$ref) {
    return true;
  }
  if (json.type) {
    return true;
  }
  if (json.const !== undefined) {
    return true;
  }
  if (json.enum) {
    return true;
  }
  if (json.allOf || json.anyOf || json.oneOf) {
    return true;
  }
  if (json.properties) {
    return true;
  }
  if (json.items) {
    return true;
  }
  return false;
}

export function isDefsOnlyDocument(json: JsonSchemaDocument): boolean {
  return getDefKeys(json).length > 0 && !hasRootValidator(json);
}

export { getDefKeys };
