import {
  mkdir,
  readFile,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export async function writeGeneratedFile(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const text = await readTextFile(path);
  return JSON.parse(text) as T;
}

export async function deleteFile(path: string): Promise<void> {
  await unlink(path);
}

export async function removeEmptyDirectory(path: string): Promise<void> {
  await rmdir(path);
}

export async function wipeOutputDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
