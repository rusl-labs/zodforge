import { isValidIdentifier } from "./naming.js";

export interface JsonSchemaToTsOptions {
  /**
   * Resolve a `$ref` string to a TypeScript type identifier already in scope
   * (a generated alias, including cross-module imports).
   */
  resolveRef: (ref: string) => string;
}

const APPLICATOR_KEYS = new Set(["oneOf", "anyOf", "allOf"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function splitTopLevel(type: string, separator: "|" | "&"): string[] {
  const token = ` ${separator} `;
  const parts: string[] = [];
  let depth = 0;
  let angle = 0;
  let start = 0;

  for (let index = 0; index < type.length; index += 1) {
    const char = type[index];
    if (char === "{" || char === "(" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
    } else if (char === "<") {
      angle += 1;
    } else if (char === ">") {
      angle -= 1;
    } else if (
      depth === 0 &&
      angle === 0 &&
      type.startsWith(token, index)
    ) {
      parts.push(type.slice(start, index).trim());
      start = index + token.length;
      index += token.length - 1;
    }
  }

  parts.push(type.slice(start).trim());
  return parts.filter(Boolean);
}

function isTopLevelUnion(type: string): boolean {
  return splitTopLevel(type, "|").length > 1;
}

function joinUnion(parts: string[]): string {
  const flattened = uniqueStrings(parts.flatMap((part) => splitTopLevel(part, "|")));
  const withoutNever = flattened.filter((part) => part !== "never");
  if (withoutNever.includes("unknown") && withoutNever.length > 1) {
    return "unknown";
  }
  if (withoutNever.length === 0) {
    return flattened.includes("never") ? "never" : "unknown";
  }
  if (withoutNever.length === 1) {
    return withoutNever[0]!;
  }
  return withoutNever.join(" | ");
}

function joinIntersection(parts: string[]): string {
  const flattened = uniqueStrings(
    parts.flatMap((part) => splitTopLevel(part, "&")),
  );
  if (flattened.includes("never")) {
    return "never";
  }
  const withoutUnknown = flattened.filter((part) => part !== "unknown");
  if (withoutUnknown.length === 0) {
    return "unknown";
  }
  if (withoutUnknown.length === 1) {
    return withoutUnknown[0]!;
  }
  return withoutUnknown
    .map((part) => (isTopLevelUnion(part) ? `(${part})` : part))
    .join(" & ");
}

function constToTs(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  return JSON.stringify(value);
}

function propertyKeyToTs(key: string): string {
  return isValidIdentifier(key) ? key : JSON.stringify(key);
}

function normalizeTypes(type: unknown): string[] {
  if (Array.isArray(type)) {
    return type.filter((item): item is string => typeof item === "string");
  }
  if (typeof type === "string") {
    return [type];
  }
  return [];
}

function requiredKeys(node: Record<string, unknown>): string[] {
  if (!Array.isArray(node.required)) {
    return [];
  }
  return node.required.filter((item): item is string => typeof item === "string");
}

function formatObject(fields: string[]): string {
  if (fields.length === 0) {
    return "Record<string, never>";
  }
  const compact = `{ ${fields.join("; ")} }`;
  if (compact.length <= 100 && !fields.some((field) => field.includes("\n"))) {
    return compact;
  }
  const indented = fields
    .map((field) => `  ${field.replace(/\n/g, "\n  ")};`)
    .join("\n");
  return `{\n${indented}\n}`;
}

function objectToTs(
  node: Record<string, unknown>,
  options: JsonSchemaToTsOptions,
  closedSibling: boolean,
): string {
  const properties = isPlainObject(node.properties) ? node.properties : {};
  const required = new Set(requiredKeys(node));
  const fields: string[] = [];
  const propTypes: string[] = [];

  for (const [key, propSchema] of Object.entries(properties)) {
    const tsType = jsonSchemaToTs(propSchema, options);
    propTypes.push(tsType);
    const optional = required.has(key) ? "" : "?";
    fields.push(`${propertyKeyToTs(key)}${optional}: ${tsType}`);
  }

  for (const key of required) {
    if (key in properties) {
      continue;
    }
    fields.push(`${propertyKeyToTs(key)}: unknown`);
    propTypes.push("unknown");
  }

  const additional = node.additionalProperties;

  if (additional === false) {
    if (fields.length === 0) {
      return "Record<string, never>";
    }
    return formatObject(fields);
  }

  // Applicator branches constrain the same object as their closed sibling.
  // Property/item recursion starts fresh, so nested open objects stay open.
  if (closedSibling && (additional === undefined || additional === true)) {
    return fields.length === 0 ? "unknown" : formatObject(fields);
  }

  if (fields.length === 0) {
    if (additional === undefined || additional === true) {
      return "Record<string, unknown>";
    }
    return `Record<string, ${jsonSchemaToTs(additional, options)}>`;
  }

  if (additional === undefined || additional === true) {
    fields.push("[key: string]: unknown");
    return formatObject(fields);
  }

  if (additional !== undefined) {
    const additionalType = jsonSchemaToTs(additional, options);
    const indexType = joinUnion([additionalType, ...propTypes]);
    fields.push(`[key: string]: ${indexType}`);
  }

  return formatObject(fields);
}

function arrayToTs(
  node: Record<string, unknown>,
  options: JsonSchemaToTsOptions,
): string {
  if (Array.isArray(node.prefixItems)) {
    const elements = node.prefixItems.map((item) => jsonSchemaToTs(item, options));
    if (node.items === false) {
      return `[${elements.join(", ")}]`;
    }
    if (node.items !== undefined && node.items !== true) {
      return `[${elements.join(", ")}, ...Array<${jsonSchemaToTs(node.items, options)}>]`;
    }
    return `[${elements.join(", ")}, ...unknown[]]`;
  }

  if (Array.isArray(node.items)) {
    const elements = node.items.map((item) => jsonSchemaToTs(item, options));
    if (node.additionalItems === false) {
      return `[${elements.join(", ")}]`;
    }
    if (node.additionalItems !== undefined && node.additionalItems !== true) {
      return `[${elements.join(", ")}, ...Array<${jsonSchemaToTs(node.additionalItems, options)}>]`;
    }
    return `[${elements.join(", ")}, ...unknown[]]`;
  }

  if (node.items === false) {
    return "[]";
  }
  if (node.items === undefined || node.items === true) {
    return "Array<unknown>";
  }
  return `Array<${jsonSchemaToTs(node.items, options)}>`;
}

function schemaWithoutApplicatorsToTs(
  node: Record<string, unknown>,
  options: JsonSchemaToTsOptions,
  closedSibling: boolean,
): string {
  if (node.const !== undefined) {
    return constToTs(node.const);
  }

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return joinUnion(node.enum.map((item) => constToTs(item)));
  }

  const types = normalizeTypes(node.type);
  if (types.length > 1) {
    return joinUnion(
      types.map((typeName) =>
        schemaWithoutApplicatorsToTs({ ...node, type: typeName }, options, closedSibling),
      ),
    );
  }

  const typeName = types[0];

  if (typeName === "null") {
    return "null";
  }
  if (typeName === "boolean") {
    return "boolean";
  }
  if (typeName === "string") {
    return "string";
  }
  if (typeName === "number" || typeName === "integer") {
    return "number";
  }

  if (
    typeName === "object" ||
    node.properties !== undefined ||
    node.additionalProperties !== undefined ||
    node.required !== undefined ||
    node.patternProperties !== undefined
  ) {
    return objectToTs(node, options, closedSibling);
  }

  if (
    typeName === "array" ||
    node.items !== undefined ||
    node.prefixItems !== undefined
  ) {
    return arrayToTs(node, options);
  }

  return "unknown";
}

/**
 * Infer a TypeScript type expression from a JSON Schema node.
 *
 * External and local `$ref`s are left as identifiers via `resolveRef`.
 * `oneOf` / `anyOf` become unions, `allOf` an intersection, `const` a literal,
 * and `additionalProperties: false` a closed object. Sibling applicators are
 * intersected with the remaining constraints, matching `compileJsonSchema`.
 */
export function jsonSchemaToTs(
  node: unknown,
  options: JsonSchemaToTsOptions,
): string {
  return schemaToTs(node, options, false);
}

function schemaToTs(
  node: unknown,
  options: JsonSchemaToTsOptions,
  closedSibling: boolean,
): string {
  if (typeof node === "boolean") {
    return node ? "unknown" : "never";
  }
  if (!isPlainObject(node)) {
    return "unknown";
  }

  if (typeof node.$ref === "string") {
    return options.resolveRef(node.$ref);
  }

  const closed = closedSibling || node.additionalProperties === false;
  const applicatorParts: string[] = [];
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    applicatorParts.push(
      joinUnion(node.oneOf.map((item) => schemaToTs(item, options, closed))),
    );
  }
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
    applicatorParts.push(
      joinUnion(node.anyOf.map((item) => schemaToTs(item, options, closed))),
    );
  }
  if (Array.isArray(node.allOf) && node.allOf.length > 0) {
    applicatorParts.push(
      joinIntersection(node.allOf.map((item) => schemaToTs(item, options, closed))),
    );
  }

  const rest: Record<string, unknown> = {};
  let hasRestConstraints = false;
  for (const [key, value] of Object.entries(node)) {
    if (APPLICATOR_KEYS.has(key)) {
      continue;
    }
    rest[key] = value;
    if (
      key === "type" ||
      key === "enum" ||
      key === "const" ||
      key === "properties" ||
      key === "required" ||
      key === "additionalProperties" ||
      key === "patternProperties" ||
      key === "propertyNames" ||
      key === "dependentSchemas" ||
      key === "dependentRequired" ||
      key === "items" ||
      key === "prefixItems" ||
      key === "contains" ||
      key === "minItems" ||
      key === "maxItems" ||
      key === "uniqueItems" ||
      key === "minContains" ||
      key === "maxContains" ||
      key === "unevaluatedItems" ||
      key === "minProperties" ||
      key === "maxProperties" ||
      key === "unevaluatedProperties" ||
      key === "minimum" ||
      key === "maximum" ||
      key === "exclusiveMinimum" ||
      key === "exclusiveMaximum" ||
      key === "multipleOf" ||
      key === "minLength" ||
      key === "maxLength" ||
      key === "pattern" ||
      key === "format" ||
      key === "if" ||
      key === "then" ||
      key === "else" ||
      key === "not" ||
      key === "$ref" ||
      key === "$dynamicRef"
    ) {
      hasRestConstraints = true;
    }
  }

  const sibling = hasRestConstraints
    ? schemaWithoutApplicatorsToTs(rest, options, closedSibling)
    : undefined;

  const parts = [sibling, ...applicatorParts].filter(
    (part): part is string => typeof part === "string",
  );

  if (parts.length === 0) {
    return "unknown";
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  return joinIntersection(parts);
}
