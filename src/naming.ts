import { basename } from "node:path";

export type NamingMode = "full" | "short";

export const DEFAULT_NAMING_MODE: NamingMode = "full";
export const DEFAULT_SCHEMA_SUFFIX = ".schema.json";
const FALLBACK_SCHEMA_SUFFIX = ".json";

function normalizeSchemaSuffix(suffix: string): string {
  return suffix.startsWith(".") ? suffix : `.${suffix}`;
}

/**
 * Strip a known schema suffix and keep the rest of the basename, dots included.
 * Preferred suffix (default `.schema.json`) is checked first, then `.json`.
 */
export function stemFromFilename(
  filename: string,
  suffix: string = DEFAULT_SCHEMA_SUFFIX,
): string {
  const base = basename(filename);
  const preferred = normalizeSchemaSuffix(suffix);
  const suffixes =
    preferred === FALLBACK_SCHEMA_SUFFIX
      ? [preferred]
      : [preferred, FALLBACK_SCHEMA_SUFFIX];

  for (const candidate of suffixes) {
    if (base.endsWith(candidate)) {
      return base.slice(0, -candidate.length);
    }
  }

  return base;
}

function splitIdentifierParts(value: string): string[] {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function toCamelCase(value: string): string {
  const parts = splitIdentifierParts(value);
  if (parts.length === 0) {
    return value;
  }

  return parts
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function nameBase(
  pathId: string,
  stem: string,
  mode: NamingMode = DEFAULT_NAMING_MODE,
): string {
  return mode === "full" ? pathId : stem;
}

export function rawExportName(base: string): string {
  return `${toCamelCase(base)}Raw`;
}

export function rawTypeExportName(base: string): string {
  return `${toPascalCase(base)}Raw`;
}

export function zodExportName(base: string): string {
  return `z${toPascalCase(base)}`;
}

export function typeExportName(base: string): string {
  return toPascalCase(base);
}

export function typeInputExportName(base: string): string {
  return `${toPascalCase(base)}Input`;
}

export function jsonImportVarName(stem: string): string {
  return `${toCamelCase(stem)}Json`;
}

export function zodDefExportName(base: string, defKey: string): string {
  return `z${toPascalCase(base)}Def${toPascalCase(defKey)}`;
}

export function defTypeExportName(base: string, defKey: string): string {
  return `${toPascalCase(base)}Def${toPascalCase(defKey)}`;
}

export function defTypeInputExportName(base: string, defKey: string): string {
  return `${toPascalCase(base)}Def${toPascalCase(defKey)}Input`;
}

export function defPathId(
  schemaPathId: string,
  defKey: string,
  defsSegment: "$defs" | "definitions" = "$defs",
): string {
  return `${schemaPathId}#/${defsSegment}/${defKey}`;
}

export function defDocumentId(
  schemaId: string,
  defKey: string,
  defsSegment: "$defs" | "definitions" = "$defs",
): string {
  return `${schemaId}#/${defsSegment}/${defKey}`;
}

export function rawSiblingImportPath(pathId: string): string {
  const fileStem = pathId.split("/").pop() ?? pathId;
  return `./${fileStem}.raw`;
}

export function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}
