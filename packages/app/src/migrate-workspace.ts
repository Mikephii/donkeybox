// One-off: moves an old `workflows/` folder (config.json, skills/, bin/) into a new workspace repo.
//   node packages/app/src/migrate-workspace.ts [--from <dir>] [--to <dir>]
// Refuses to write into a non-empty folder. Converts the config to today's shape and removes the
// workbench's own services (they are built in now). Nothing else is rewritten.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { normalizeLegacy, parseConfig } from "./engine/config.ts";
import { isEmptyDir } from "./lib/workspace.ts";
import { env, ROOT, WORKSPACE_DIR } from "./env.ts";

const CORE = new Set(["app", "yjs", "hooks", "web", "zellij-web", "caddy"]);

export function migrateConfig(old: Record<string, any>, template: Record<string, any>): Record<string, any> {
  const c = normalizeLegacy(old);
  return {
    $schema: template.$schema,
    settings: { ...template.settings, ...(c.settings ?? {}) },
    sources: c.sources ?? {},
    groups: c.groups ?? {},
    rules: c.rules ?? [],
    services: (c.services ?? []).filter((s: any) => !CORE.has(s.id)).map((s: any) => {
      if (!s.run) return s;
      const args = s.run.args.map((a: string) => (a === "scripts/demo-server.ts" ? "bin/demo-server.ts" : a));
      return { ...s, run: { ...s.run, args } };
    }),
    repos: c.repos ?? [],
    terminals: c.terminals ?? template.terminals,
  };
}

export function migrateWorkspace(from: string, to: string, templateDir: string) {
  if (!existsSync(join(from, "config.json"))) throw new Error(`nothing to migrate: ${from}/config.json not found`);
  if (!isEmptyDir(to)) throw new Error(`${to} is not empty; refusing to overwrite it`);
  cpSync(templateDir, to, { recursive: true });
  const template = JSON.parse(readFileSync(join(templateDir, "config.json"), "utf8"));
  const next = migrateConfig(JSON.parse(readFileSync(join(from, "config.json"), "utf8")), template);
  const parsed = parseConfig(next);
  if (!parsed.ok) throw new Error(`migrated config is invalid:\n${parsed.errors.join("\n")}`);
  writeFileSync(join(to, "config.json"), JSON.stringify(next, null, 2) + "\n");
  if (existsSync(join(from, "skills"))) {
    rmSync(join(to, ".claude/skills"), { recursive: true, force: true });
    cpSync(join(from, "skills"), join(to, ".claude/skills"), { recursive: true });
  }
  if (existsSync(join(from, "bin"))) for (const f of readdirSync(join(from, "bin"))) cpSync(join(from, "bin", f), join(to, "bin", f));
  const git = (...a: string[]) => execFileSync("git", ["-C", to, ...a], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=Workbench", "-c", "user.email=workbench@localhost", "commit", "-q", "-m", `Migrate from ${from}`);
  rmSync(from, { recursive: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
  const from = resolve(values.from ?? join(ROOT, "workflows"));
  const to = resolve(values.to ?? WORKSPACE_DIR);
  try {
    migrateWorkspace(from, to, env.templateDir);
    console.log(`Moved ${from} into the workspace at ${to} (a git repo with one commit). ${from} is gone.`);
  } catch (e) {
    console.error(`wb migrate-workspace: ${(e as Error).message}`);
    process.exit(1);
  }
}
