import { glob } from "tinyglobby";
import { dirname, relative, resolve } from "node:path";
import {
  DEFAULT_SCHEMA_GLOB,
  DEFAULT_SCHEMAS_DIR,
  type OutputKind,
  type ResolvedSchemaFile,
} from "./types.js";
import { stemFromFilename } from "./naming.js";
import { assertUniqueResolvedFiles } from "./unique.js";

function toResolvedSchemaFile(
  absolutePath: string,
  schemasDir: string,
  pathPrefix?: string,
  suffix?: string,
): ResolvedSchemaFile {
  const relativePath = relative(schemasDir, absolutePath).replace(/\\/g, "/");
  const stem = stemFromFilename(absolutePath, suffix);
  const parentDir = dirname(relativePath).replace(/\\/g, "/");
  let pathId = parentDir === "." ? stem : `${parentDir}/${stem}`;

  if (pathPrefix) {
    const normalizedPrefix = pathPrefix.replace(/\\/g, "/").replace(/\/$/, "");
    if (pathId.startsWith(`${normalizedPrefix}/`)) {
      pathId = pathId.slice(normalizedPrefix.length + 1);
    } else if (pathId === normalizedPrefix) {
      pathId = stem;
    }
  }

  return { absolutePath, pathId, stem, relativePath };
}

export function computePathId(
  absolutePath: string,
  schemasDir: string,
  pathPrefix?: string,
  suffix?: string,
): string {
  return toResolvedSchemaFile(absolutePath, schemasDir, pathPrefix, suffix)
    .pathId;
}

export function computeOutputRelativePath(
  pathId: string,
  kind: OutputKind,
): string {
  return `${pathId}.${kind}.ts`;
}

export async function resolveSchemaFiles(options: {
  path?: string;
  cwd?: string;
  schemasDir?: string;
  pathPrefix?: string;
  suffix?: string;
}): Promise<ResolvedSchemaFile[]> {
  const cwd = options.cwd ?? process.cwd();
  const schemasDir = resolve(cwd, options.schemasDir ?? DEFAULT_SCHEMAS_DIR);
  const pattern = options.path ?? DEFAULT_SCHEMA_GLOB;

  const files = await glob(pattern, {
    cwd,
    absolute: true,
    onlyFiles: true,
  });

  const resolved = files
    .map((absolutePath) =>
      toResolvedSchemaFile(
        absolutePath,
        schemasDir,
        options.pathPrefix,
        options.suffix,
      ),
    )
    .sort(
      (left, right) =>
        left.pathId.localeCompare(right.pathId) ||
        left.relativePath.localeCompare(right.relativePath),
    );

  assertUniqueResolvedFiles(resolved);
  return resolved;
}
