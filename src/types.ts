import type { ZodType } from "zod";

export const DEFAULT_SCHEMA_GLOB = "./schemas/**/*.json";
export const DEFAULT_SCHEMAS_DIR = "./schemas";
export const DEFAULT_OUTPUT_DIR = "./src/schemas";
export const MANIFEST_FILENAME = ".zodforge-manifest.json";

export interface GenerateOptions {
  path?: string;
  cwd?: string;
  schemasDir?: string;
  outputDir?: string;
  pathPrefix?: string;
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
  suffix?: string;
  register?: boolean;
}

export interface ResolvedSchemaFile {
  absolutePath: string;
  pathId: string;
  stem: string;
  relativePath: string;
}

export interface CompiledSchema {
  schema: ZodType;
  pathId: string;
  schemaExport: string;
  typeExport: string;
  typeInputExport: string;
  jsonImportVar: string;
  jsonImportPath: string;
  sourcePath: string;
  outputRelativePath: string;
  id?: string;
  title?: string;
  description?: string;
}

export interface ForgeResult {
  byId: Record<string, ZodType>;
  byPath: Record<string, ZodType>;
  [exportName: string]: ZodType | Record<string, ZodType>;
}

export interface ZodforgeManifest {
  version: 1;
  generatedAt: string;
  outputDir: string;
  files: string[];
}
