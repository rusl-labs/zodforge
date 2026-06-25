import { glob } from "tinyglobby";
import { dirname, relative, resolve } from "node:path";
import {
  DEFAULT_SCHEMA_GLOB,
  DEFAULT_SCHEMAS_DIR,
  type ResolvedSchemaFile,
} from "./types.js";
import { stemFromFilename } from "./naming.js";

export function computePathId(
  absolutePath: string,
  schemasDir: string,
  pathPrefix?: string,
): string {
  const relativePath = relative(schemasDir, absolutePath).replace(/\\/g, "/");
  const stem = stemFromFilename(absolutePath);
  const parentDir = dirname(relativePath).replace(/\\/g, "/");
  let pathId =
    parentDir === "." ? stem : `${parentDir}/${stem}`.replace(/\\/g, "/");

  if (pathPrefix) {
    const normalizedPrefix = pathPrefix.replace(/\\/g, "/").replace(/\/$/, "");
    if (pathId.startsWith(`${normalizedPrefix}/`)) {
      pathId = pathId.slice(normalizedPrefix.length + 1);
    } else if (pathId === normalizedPrefix) {
      pathId = stem;
    }
  }

  return pathId;
}

export function computeOutputRelativePath(pathId: string): string {
  return `${pathId}.ts`;
}

export async function resolveSchemaFiles(options: {
  path?: string;
  cwd?: string;
  schemasDir?: string;
  pathPrefix?: string;
}): Promise<ResolvedSchemaFile[]> {
  const cwd = options.cwd ?? process.cwd();
  const schemasDir = resolve(cwd, options.schemasDir ?? DEFAULT_SCHEMAS_DIR);
  const pattern = options.path ?? DEFAULT_SCHEMA_GLOB;

  const files = await glob(pattern, {
    cwd,
    absolute: true,
    onlyFiles: true,
  });

  return files
    .map((absolutePath) => {
      const stem = stemFromFilename(absolutePath);
      const pathId = computePathId(absolutePath, schemasDir, options.pathPrefix);
      const relativePath = relative(schemasDir, absolutePath).replace(/\\/g, "/");

      return {
        absolutePath,
        pathId,
        stem,
        relativePath,
      };
    })
    .sort((left, right) => left.pathId.localeCompare(right.pathId));
}
