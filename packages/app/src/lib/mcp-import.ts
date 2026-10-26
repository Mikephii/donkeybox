import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_NAME } from "./secrets.ts";

/**
 * Reads the MCP servers the box's Claude Code user has configured (user scope in ~/.claude.json, local
 * scope per project in the same file, project scope in the workspace's .mcp.json) so a
 * workflow can import them. Values that look like secrets are masked in listings and moved into the
 * secrets store on import, leaving ${secret:NAME} in config.json.
 */
export interface FoundServer {
  key: string;
  name: string;
  scope: "user" | "local" | "project";
  /** For local and project scope: the folder the server belongs to. */
  where: string | null;
  type: string;
  summary: string;
  /** The definition with secret-looking values replaced by "••••". */
  masked: Record<string, unknown>;
  secrets: string[];
}

const SECRETISH_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|auth|bearer|credential|private)/i;
const SECRETISH_VALUE = /^(Bearer|Basic|token)\s+\S{8,}$|^(sk|pk|ghp|gho|ghs|github_pat|xox[abp]|glpat|AKIA)[-_A-Za-z0-9]{8,}/;

/** Paths inside a server definition whose values should not live in config.json. */
export function secretPaths(def: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of ["env", "headers"] as const) {
    const o = def[field];
    if (!o || typeof o !== "object") continue;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v !== "string" || !v || /\$\{secret:/.test(v)) continue;
      // ${VAR} references are resolved by Claude Code from the environment; leave them alone.
      if (/^\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}$/.test(v)) continue;
      if (SECRETISH_KEY.test(k) || SECRETISH_VALUE.test(v)) out.push(`${field}.${k}`);
    }
  }
  return out;
}

function mask(def: Record<string, unknown>, paths: string[]) {
  const copy = JSON.parse(JSON.stringify(def)) as Record<string, any>;
  for (const p of paths) {
    const [f, k] = p.split(".", 2) as [string, string];
    copy[f][k] = "••••";
  }
  return copy;
}

function summary(def: Record<string, any>) {
  if (def.url) return String(def.url);
  return [def.command, ...(def.args ?? [])].filter(Boolean).join(" ");
}

function entries(defs: unknown, scope: FoundServer["scope"], where: string | null): FoundServer[] {
  if (!defs || typeof defs !== "object") return [];
  return Object.entries(defs as Record<string, Record<string, unknown>>)
    .filter(([name]) => name !== "workbench")
    .map(([name, def]) => {
      const secrets = secretPaths(def);
      return {
        key: `${scope}:${where ?? ""}:${name}`,
        name,
        scope,
        where,
        type: String(def.type ?? (def.url ? "http" : "stdio")),
        summary: summary(def),
        masked: mask(def, secrets),
        secrets,
      };
    });
}

export function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Every server the box user can see, without the workbench's own. */
export function findServers(o: { claudeConfig: string; workspace: string }): { servers: FoundServer[]; raw: Map<string, Record<string, unknown>> } {
  const raw = new Map<string, Record<string, unknown>>();
  const out: FoundServer[] = [];
  const add = (list: FoundServer[], defs: Record<string, Record<string, unknown>>) => {
    for (const s of list) {
      out.push(s);
      raw.set(s.key, defs[s.name]!);
    }
  };
  const cfg = readJson(o.claudeConfig) ?? {};
  if (cfg.mcpServers) add(entries(cfg.mcpServers, "user", null), cfg.mcpServers);
  for (const [path, p] of Object.entries((cfg.projects ?? {}) as Record<string, any>)) if (p?.mcpServers && Object.keys(p.mcpServers).length) add(entries(p.mcpServers, "local", path), p.mcpServers);
  // Local scope already covers every folder Claude Code was used in on this box.
  const projectFiles = [o.workspace];
  for (const dir of projectFiles) {
    const j = readJson(join(dir, ".mcp.json"));
    if (j?.mcpServers) add(entries(j.mcpServers, "project", dir), j.mcpServers);
  }
  return { servers: out, raw };
}

/**
 * Turns one found server into a workflow entry. Each secret-looking value becomes a secret named
 * <SERVER>_<KEY> (with a number added if taken by a different value), and the definition keeps
 * ${secret:NAME}. A "Bearer xyz" header keeps its prefix.
 */
export async function importServer(
  def: Record<string, unknown>,
  name: string,
  store: { resolve(n: string): string | undefined; create(n: string, v: string): Promise<unknown> },
): Promise<{ def: Record<string, unknown>; created: string[]; reused: string[] }> {
  const copy = JSON.parse(JSON.stringify(def)) as Record<string, any>;
  const created: string[] = [];
  const reused: string[] = [];
  for (const p of secretPaths(def)) {
    const [field, key] = p.split(".", 2) as [string, string];
    const value = String(copy[field][key]);
    const m = value.match(/^(Bearer |Basic |token )(.+)$/);
    const secret = m ? m[2]! : value;
    const base = `${name}_${field === "headers" && /^authorization$/i.test(key) ? "TOKEN" : key}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^[^A-Z]+/, "").slice(0, 60) || "MCP_SECRET";
    let secretName = SECRET_NAME.test(base) ? base : `MCP_${base}`.slice(0, 64);
    for (let i = 2; store.resolve(secretName) !== undefined && store.resolve(secretName) !== secret; i++) secretName = `${base}_${i}`.slice(0, 64);
    if (store.resolve(secretName) === secret) reused.push(secretName);
    else {
      await store.create(secretName, secret);
      created.push(secretName);
    }
    copy[field][key] = `${m ? m[1] : ""}\${secret:${secretName}}`;
  }
  return { def: copy, created, reused };
}
