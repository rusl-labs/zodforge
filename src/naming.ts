import { basename } from "node:path";

export function stemFromFilename(filename: string): string {
  return basename(filename).split(".")[0] ?? basename(filename);
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

export function schemaExportName(stem: string, suffix = "Schema"): string {
  return `${toCamelCase(stem)}${suffix}`;
}

export function typeExportName(stem: string): string {
  return toPascalCase(stem);
}

export function typeInputExportName(stem: string): string {
  return `${toPascalCase(stem)}Input`;
}

export function jsonImportVarName(stem: string): string {
  return `${toCamelCase(stem)}Json`;
}

export function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}
