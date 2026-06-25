import { fromJSONSchema } from "zod";
import type { ZodType } from "zod";
import { dirname, relative } from "node:path";
import { readJsonFile } from "./fs.js";
import {
  jsonImportVarName,
  schemaExportName,
  stemFromFilename,
  typeExportName,
  typeInputExportName,
} from "./naming.js";
import { computeOutputRelativePath, computePathId } from "./resolve.js";
import type { CompiledSchema } from "./types.js";

interface JsonSchemaDocument {
  $id?: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

export interface CompileOptions {
  schemasDir: string;
  pathPrefix?: string;
  suffix?: string;
  register?: boolean;
}

export function compileSchemaFromJson(
  json: JsonSchemaDocument,
  metadata: {
    absolutePath: string;
    schemasDir: string;
    pathPrefix?: string;
    suffix?: string;
    register?: boolean;
  },
): CompiledSchema {
  const stem = stemFromFilename(metadata.absolutePath);
  const pathId = computePathId(
    metadata.absolutePath,
    metadata.schemasDir,
    metadata.pathPrefix,
  );
  const schemaExport = schemaExportName(stem, metadata.suffix);
  const typeExport = typeExportName(stem);
  const typeInputExport = typeInputExportName(stem);
  const jsonImportVar = jsonImportVarName(stem);

  let schema: ZodType = fromJSONSchema(json);

  const meta = {
    id: json.$id,
    title: json.title,
    description: json.description,
    pathId,
  };

  if (metadata.register !== false) {
    schema = schema.meta(meta);
  }

  return {
    schema,
    pathId,
    schemaExport,
    typeExport,
    typeInputExport,
    jsonImportVar,
    jsonImportPath: metadata.absolutePath,
    sourcePath: metadata.absolutePath,
    outputRelativePath: computeOutputRelativePath(pathId),
    id: json.$id,
    title: json.title,
    description: json.description,
  };
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
    suffix: options.suffix,
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
