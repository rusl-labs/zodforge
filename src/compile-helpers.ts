import type { JsonSchemaDocument } from "./types.js";

function getDefKeys(json: JsonSchemaDocument): string[] {
  const defs = json.$defs ?? json.definitions;
  if (!defs || typeof defs !== "object") {
    return [];
  }
  return Object.keys(defs);
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
