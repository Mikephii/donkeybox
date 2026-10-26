import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseConfig } from "../src/engine/config.ts";
import { buildRunSpec } from "../src/engine/runspec.ts";
import type { RunRow } from "../src/engine/types.ts";
import { adminAllowed } from "../../mcp/src/tools.ts";
import { baseConfig } from "./helpers.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MCP = join(ROOT, "packages/mcp/src/server.ts");

async function toolNames(env: Record<string, string>): Promise<string[]> {
  const client = new Client({ name: "test", version: "0" });
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("WB_"))) as Record<string, string>;
  await client.connect(new StdioClientTransport({ command: "node", args: [MCP], env: { ...clean, ...env } }));
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name).sort();
}

describe("runs never get admin tools", () => {
  it("adminAllowed needs WB_ADMIN and no run id", () => {
    expect(adminAllowed({ WB_ADMIN: "1" })).toBe(true);
    expect(adminAllowed({ WB_ADMIN: "1", WB_RUN_ID: "7" })).toBe(false);
    expect(adminAllowed({ WB_RUN_ID: "7" })).toBe(false);
    expect(adminAllowed({})).toBe(false);
  });

  it("the MCP server lists setup tools only for the human session", async () => {
    const human = await toolNames({ WB_ADMIN: "1", WB_ADMIN_TOKEN: "x" });
    const run = await toolNames({ WB_ADMIN: "1", WB_RUN_ID: "7" });
    expect(human).toEqual(expect.arrayContaining(["upsert_workflow", "write_skill", "upsert_rule", "upsert_source", "upsert_window", "setup_reference"]));
    expect(run).toEqual(["ask_humans", "create_request", "list_groups", "list_requests", "note"]);
  }, 30_000);

  it("a run's generated config has no admin flag and denies reading the token", () => {
    const cfg = (parseConfig(baseConfig) as any).config;
    const dir = mkdtempSync(join(tmpdir(), "wb-spec-"));
    const run = { id: 3, prompt: "x", session_id: "00000000-0000-4000-8000-000000000000", resume_session_id: null, workdir: null, model: null, goal: null } as unknown as RunRow;
    const spec = buildRunSpec(run, "house", cfg.groups.house, {
      runsDir: dir, workDir: dir, skillsDir: dir, hooksDir: dir, mcpServer: MCP, localApiUrl: "http://127.0.0.1:1", claudeBin: "claude", extraPath: [], adminTokenFile: "/srv/data/admin.token",
    }, false);
    const mcp = JSON.parse(readFileSync(join(spec.dir, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.workbench.env).toEqual({ WB_RUN_ID: "3", WB_LOCAL_API: "http://127.0.0.1:1" });
    const settings = JSON.parse(readFileSync(join(spec.dir, "settings.json"), "utf8"));
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Read(//srv/data/admin.token)"]));
    expect(readFileSync(spec.script, "utf8")).toMatch(/--strict-mcp-config/);
  });

  it("wb refuses admin commands inside a run", () => {
    const r = spawnSync("node", [join(ROOT, "packages/cli/src/wb.ts"), "admin", "workflows"], { env: { ...process.env, WB_RUN_ID: "7", WB_LOCAL_API: "http://127.0.0.1:1" }, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not for runs/);
  });
});
