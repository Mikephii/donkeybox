// The JSON schema for config.json, generated from the same zod schema the app validates with.
//   node src/schema.ts            writes schema/config.schema.json at the product root
// The app also publishes it into each workspace (.workbench/config.schema.json) so editors validate
// config.json offline; the template's "$schema" points there.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { configSchema } from "./engine/config.ts";

export function schemaText(): string {
  const s = z.toJSONSchema(configSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return JSON.stringify({ ...s, title: "Workbench config.json", description: "Sources, workflows, rules, services, repos, terminals and settings for one workbench box." }, null, 2) + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ROOT } = await import("./env.ts");
  const out = join(ROOT, "schema/config.schema.json");
  writeFileSync(out, schemaText());
  console.log(`wrote ${out}`);
}
