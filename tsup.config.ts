import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node18",
    outDir: "dist",
    tsconfig: "tsconfig.build.json",
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
  },
]);
