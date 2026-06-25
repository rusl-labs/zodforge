import { fromJSONSchema } from "zod";
import type { ZodType } from "zod";
import { dirname, relative } from "node:path";
import { readJsonFile } from "./fs.js";
import {
  defDocumentId,
  defPathId,
  defSchemaExportName,
  defTypeExportName,
  defTypeInputExportName,
  jsonImportVarName,
  schemaExportName,
  stemFromFilename,
  typeExportName,
  typeInputExportName,
} from "./naming.js";
import { computeOutputRelativePath, computePathId } from "./resolve.js";
import type { CompiledDef, CompiledSchema } from "./types.js";

interface JsonSchemaDocument {
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

export interface CompileOptions {
  schemasDir: string;
  pathPrefix?: string;
  suffix?: string;
  register?: boolean;
}

function getDefKeys(json: JsonSchemaDocument): string[] {
  const defs = json.$defs ?? json.definitions;
  if (!defs || typeof defs !== "object") {
    return [];
  }

  return Object.keys(defs).sort();
}

function getDefsSegment(json: JsonSchemaDocument): "$defs" | "definitions" {
  if (json.$defs) {
    return "$defs";
  }
  if (json.definitions) {
    return "definitions";
  }
  return "$defs";
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

function compileDefFromJson(
  json: JsonSchemaDocument,
  metadata: {
    schemaStem: string;
    pathId: string;
    defKey: string;
    defsSegment: "$defs" | "definitions";
    register?: boolean;
  },
): CompiledDef {
  const refPath = `#/${metadata.defsSegment}/${metadata.defKey}`;
  const defDocument: JsonSchemaDocument = {
    ...json,
    $ref: refPath,
  };
  const defJson = (json.$defs ?? json.definitions)?.[metadata.defKey];

  let schema: ZodType = fromJSONSchema(
    defDocument as Parameters<typeof fromJSONSchema>[0],
  );
  const pathId = defPathId(
    metadata.pathId,
    metadata.defKey,
    metadata.defsSegment,
  );
  const id = json.$id
    ? defDocumentId(json.$id, metadata.defKey, metadata.defsSegment)
    : undefined;
  const meta = {
    id,
    pathId,
    title: defJson?.title,
    description: defJson?.description,
  };

  if (metadata.register !== false) {
    schema = schema.meta(meta);
  }

  return {
    defKey: metadata.defKey,
    refPath,
    pathId,
    id,
    schema,
    schemaExport: defSchemaExportName(metadata.schemaStem, metadata.defKey),
    typeExport: defTypeExportName(metadata.schemaStem, metadata.defKey),
    typeInputExport: defTypeInputExportName(metadata.schemaStem, metadata.defKey),
    title: defJson?.title,
    description: defJson?.description,
  };
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
  const defsSegment = getDefsSegment(json);
  const isDefsOnly = isDefsOnlyDocument(json);

  let schema: ZodType = fromJSONSchema(
    json as Parameters<typeof fromJSONSchema>[0],
  );

  const meta = {
    id: json.$id,
    title: json.title,
    description: json.description,
    pathId,
  };

  if (metadata.register !== false) {
    schema = schema.meta(meta);
  }

  const defs = getDefKeys(json).map((defKey) =>
    compileDefFromJson(json, {
      schemaStem: stem,
      pathId,
      defKey,
      defsSegment,
      register: metadata.register,
    }),
  );

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
    defs,
    isDefsOnly,
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
