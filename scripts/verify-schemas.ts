import { verifyGeneratedSchemas } from "../src/verify.ts";

const result = await verifyGeneratedSchemas();

if (result.ok) {
  console.log("Derived schemas are up to date with schemas/");
  process.exit(0);
}

console.error("Derived schemas are stale. Run: bun run schemas:generate");
console.error("Stale files:");
for (const file of result.stale) {
  console.error(`  ${file}`);
}
process.exit(1);
