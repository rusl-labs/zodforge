import { cleanGeneratedSchemas } from "./clean.js";
import { generateSchemas } from "./generate.js";
import {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_SCHEMA_GLOB,
  DEFAULT_SCHEMAS_DIR,
} from "./types.js";

interface ParsedArgs {
  command?: string;
  path?: string;
  outputDir?: string;
  schemasDir?: string;
  pathPrefix?: string;
  cwd?: string;
  help?: boolean;
}

function printHelp(): void {
  console.log(`zodforge — JSON Schema to Zod codegen

Usage:
  zodforge generate [options]
  zodforge clean [options]

Generate options:
  --path <glob>            Schema glob (default: ${DEFAULT_SCHEMA_GLOB})
  -o, --output-dir <dir>   Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --schemas-dir <dir>      Schemas root (default: ${DEFAULT_SCHEMAS_DIR})
  --path-prefix <prefix>   Strip prefix from pathId values
  --cwd <dir>              Working directory (default: process.cwd())

Clean options:
  -o, --output-dir <dir>   Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --cwd <dir>              Working directory (default: process.cwd())
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  const args = [...argv];

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    parsed.help = true;
    return parsed;
  }

  parsed.command = args.shift();

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      break;
    }

    switch (token) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--path":
        parsed.path = args.shift();
        break;
      case "-o":
      case "--output-dir":
        parsed.outputDir = args.shift();
        break;
      case "--schemas-dir":
        parsed.schemasDir = args.shift();
        break;
      case "--path-prefix":
        parsed.pathPrefix = args.shift();
        break;
      case "--cwd":
        parsed.cwd = args.shift();
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2));

    if (parsed.help || !parsed.command) {
      printHelp();
      process.exit(parsed.help ? 0 : 1);
      return;
    }

    if (parsed.command === "generate") {
      const manifest = await generateSchemas({
        path: parsed.path,
        cwd: parsed.cwd,
        schemasDir: parsed.schemasDir,
        outputDir: parsed.outputDir,
        pathPrefix: parsed.pathPrefix,
      });
      console.log(
        `Generated ${manifest.files.length} files in ${manifest.outputDir}`,
      );
      return;
    }

    if (parsed.command === "clean") {
      const result = await cleanGeneratedSchemas({
        cwd: parsed.cwd,
        outputDir: parsed.outputDir,
      });
      if (result.warned) {
        console.warn(result.warned);
      } else {
        console.log(`Removed ${result.removed.length} generated files`);
      }
      return;
    }

    throw new Error(`Unknown command: ${parsed.command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

await main();
