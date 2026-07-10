import type { ZodType } from "zod";
import type { NamingMode } from "./naming.js";

export const DEFAULT_SCHEMA_GLOB = "./schemas/**/*.json";
export const DEFAULT_SCHEMAS_DIR = "./schemas";
export const DEFAULT_OUTPUT_DIR = "./src/schemas";
export const MANIFEST_FILENAME = ".zodforge-manifest.json";

export type OutputKind = "raw" | "zod";

export interface JsonSchemaDocument {
  $id?: string;
  $schema?: string;
  title?: string;
  description?: string;
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  allOf?: unknown[];
  anyOf?: unknown[];
  oneOf?: unknown[];
  properties?: Record<string, unknown>;
  items?: unknown;
  $defs?: Record<string, JsonSchemaDocument>;
  definitions?: Record<string, JsonSchemaDocument>;
  [key: string]: unknown;
}

export interface GenerateOptions {
  path?: string;
  cwd?: string;
  schemasDir?: string;
  outputDir?: string;
  pathPrefix?: string;
  naming?: NamingMode;
  cleanBeforeGenerate?: boolean;
}

export interface CleanOptions {
  outputDir?: string;
  cwd?: string;
  silent?: boolean;
}

export interface ForgeOptions {
  path?: string;
  cwd?: string;
  schemasDir?: string;
  pathPrefix?: string;
  naming?: NamingMode;
  register?: boolean;
}

export interface ResolvedSchemaFile {
  absolutePath: string;
  pathId: string;
  stem: string;
  relativePath: string;
}

export interface CompiledDef {
  defKey: string;
  refPath: string;
  pathId: string;
  id?: string;
  schema: ZodType;
  zodExport: string;
  typeExport: string;
  typeInputExport: string;
  title?: string;
  description?: string;
}

/** An external `$ref` rewritten to an import of another generated Zod export. */
export interface ExternalZodDep {
  /** Original `$ref` string as it appears in the JSON Schema */
  ref: string;
  /** pathId of the module that owns the export */
  pathId: string;
  /** Binding name to import, e.g. `zPragmaticGeoDefPoint` */
  zodExport: string;
}

export interface CompiledSchema {
  schema: ZodType;
  pathId: string;
  stem: string;
  rawExport: string;
  rawTypeExport: string;
  zodExport: string;
  typeExport: string;
  typeInputExport: string;
  jsonImportVar: string;
  jsonImportPath: string;
  sourcePath: string;
  rawOutputRelativePath: string;
  zodOutputRelativePath: string;
  /** Original vendored document — external `$ref`s preserved. */
  rawJson: JsonSchemaDocument;
  id?: string;
  title?: string;
  description?: string;
  defs: CompiledDef[];
  isDefsOnly: boolean;
  /** Sibling Zod exports this module must import to satisfy external `$ref`s. */
  externalDeps: ExternalZodDep[];
  hasExternalRefs: boolean;
}

export interface ZodLookupEntry {
  pathId: string;
  zodExport: string;
  importPath: string;
  id?: string;
}

export interface RawLookupEntry {
  pathId: string;
  rawExport: string;
  importPath: string;
  id?: string;
}

export interface ForgeResult {
  byId: Record<string, ZodType>;
  byPath: Record<string, ZodType>;
  rawByPath: Record<string, JsonSchemaDocument>;
  rawById: Record<string, JsonSchemaDocument>;
  [exportName: string]:
    | ZodType
    | JsonSchemaDocument
    | Record<string, ZodType>
    | Record<string, JsonSchemaDocument>;
}

export interface ZodforgeManifest {
  version: 1;
  generatedAt: string;
  outputDir: string;
  files: string[];
}
