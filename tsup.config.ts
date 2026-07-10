import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const root = dirname(fileURLToPath(import.meta.url));

function copyRuntimeHelper(): void {
  const destDir = join(root, "dist/runtime");
  mkdirSync(destDir, { recursive: true });
  copyFileSync(
    join(root, "src/runtime/compile-json-schema.ts"),
    join(destDir, "compile-json-schema.ts"),
  );
}

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node18",
    outDir: "dist",
    tsconfig: "tsconfig.build.json",
    onSuccess: async () => {
      copyRuntimeHelper();
    },
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    target: "node18",
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
    onSuccess: async () => {
      // First entry's clean:true can race; always re-copy the TS helper.
      copyRuntimeHelper();
    },
  },
]);
