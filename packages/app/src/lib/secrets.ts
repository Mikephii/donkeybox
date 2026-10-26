import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../engine/config.ts";
import { GcpSecretBackend } from "./gcp/secret-manager.ts";

/**
 * Secrets are referenced by NAME everywhere (verifiers, MCP env and headers, repo tokens, sign-in)
 * and resolved store first, then an environment variable of the same name. Values never go into
 * config.json, git, logs, or any API response after the one that created them.
 */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]{0,63})\}/g;

export interface SecretMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretBackend {
  readonly kind: "file" | "gcp";
  /** Every secret with its value. Only the store itself sees values. */
  load(): Promise<Map<string, SecretMeta & { value: string }>>;
  put(name: string, value: string, existing: boolean): Promise<void>;
  remove(name: string): Promise<void>;
}

export class SecretError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details: unknown = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** A JSON file in the data folder, mode 600, written atomically. Local and self-hosted boxes. */
export class FileSecretBackend implements SecretBackend {
  readonly kind = "file" as const;
  private mtime = 0;
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  changed() {
    try {
      return statSync(this.path).mtimeMs !== this.mtime;
    } catch {
      return this.mtime !== 0;
    }
  }
  private read(): Record<string, SecretMeta & { value: string }> {
    if (!existsSync(this.path)) return {};
    const st = statSync(this.path);
    // Someone loosened the file's mode by hand: put it back.
    if ((st.mode & 0o077) !== 0) chmodSync(this.path, 0o600);
    this.mtime = st.mtimeMs;
    const j = JSON.parse(readFileSync(this.path, "utf8"));
    return j.secrets ?? {};
  }
  readSync() {
    return new Map(Object.entries(this.read()).map(([k, v]) => [k, { ...v, name: k }]));
  }
  async load() {
    return this.readSync();
  }
  private write(all: Record<string, unknown>) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, secrets: all }, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    this.mtime = statSync(this.path).mtimeMs;
  }
  async put(name: string, value: string) {
    const all = this.read();
    const now = new Date().toISOString();
    all[name] = { name, value, createdAt: all[name]?.createdAt ?? now, updatedAt: now };
    this.write(all);
  }
  async remove(name: string) {
    const all = this.read();
    delete all[name];
    this.write(all);
  }
}

export interface SecretUse {
  /** Where the name is referenced, e.g. "source github", "workflow jira-tickets (MCP atlassian env)". */
  where: string;
  link: string;
}

/** Every place config.json refers to a secret by name. */
export function secretUses(c: Config, authMode?: string): Map<string, SecretUse[]> {
  const uses = new Map<string, SecretUse[]>();
  const add = (name: string | undefined, where: string, link: string) => {
    if (!name) return;
    const list = uses.get(name) ?? [];
    list.push({ where, link });
    uses.set(name, list);
  };
  for (const [id, s] of Object.entries(c.sources)) if (s.verify && s.verify.kind !== "none") add(s.verify.secret, `source ${id}`, `/sources?s=${id}`);
  for (const [id, g] of Object.entries(c.groups))
    for (const [server, def] of Object.entries(g.mcpServers ?? {}))
      for (const name of secretRefs(def)) add(name, `workflow ${id} (MCP ${server})`, `/workflows/${id}?tab=mcp`);
  const st = c.settings;
  if (st.scheduler.mode === "external") add(st.scheduler.secret, "settings (external scheduler)", "/settings");
  // Sign-in secrets only matter for the mode the box runs in (AUTH_MODE); unknown mode counts both.
  if (!authMode || authMode === "proxy") add(st.auth.proxy.secret || undefined, "settings (proxy sign-in)", "/settings?tab=doors");
  if ((!authMode || authMode === "oidc") && st.auth.oidc.issuer) add(st.auth.oidc.clientSecret, "settings (OIDC sign-in)", "/settings?tab=doors");
  return uses;
}

/** Names referenced as ${secret:NAME} anywhere inside a value (MCP server definitions). */
export function secretRefs(v: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: unknown) => {
    if (typeof x === "string") for (const m of x.matchAll(SECRET_REF)) out.add(m[1]!);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(v);
  return [...out];
}

export const generateSecret = () => randomBytes(32).toString("base64url");

/**
 * The store the app, the webhook listener and the run launcher share. Values are cached in memory so
 * resolving is synchronous; the file backend reloads when the file changes, Secret Manager every minute.
 */
export class SecretStore {
  private cache = new Map<string, SecretMeta & { value: string }>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  onChange: (what: { name: string; action: "created" | "rotated" | "deleted" }) => void = () => {};
  readonly backend: SecretBackend;
  readonly o: { env?: NodeJS.ProcessEnv; refreshMs?: number; authMode?: string };
  constructor(backend: SecretBackend, o: { env?: NodeJS.ProcessEnv; refreshMs?: number; authMode?: string } = {}) {
    this.backend = backend;
    this.o = o;
  }

  async load() {
    this.loading ??= this.backend
      .load()
      .then((m) => {
        this.cache = m;
        this.loadedAt = Date.now();
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  private maybeRefresh() {
    if (Date.now() - this.loadedAt > (this.o.refreshMs ?? 60_000)) void this.load().catch(() => {});
  }

  /** Store first, then the environment. Undefined when neither has it. */
  resolve = (name: string): string | undefined => {
    if (!(this.backend instanceof FileSecretBackend)) this.maybeRefresh();
    else if (this.backend.changed()) {
      // Synchronous re-read for the file backend so a rotation applies to the very next delivery.
      try {
        this.cache = this.backend.readSync();
      } catch {}
    }
    return this.cache.get(name)?.value ?? (this.o.env ?? process.env)[name] ?? undefined;
  };

  /** Replaces every ${secret:NAME} in strings inside v. Unknown names are left as they are. */
  expand<T>(v: T): T {
    const walk = (x: any): any => {
      if (typeof x === "string") return x.replace(SECRET_REF, (m, n) => this.resolve(n) ?? m);
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
      return x;
    };
    return walk(v);
  }

  where(name: string): "store" | "env" | null {
    if (this.cache.has(name)) return "store";
    if ((this.o.env ?? process.env)[name] !== undefined) return "env";
    return null;
  }

  /** Names, dates and uses. Never values. Includes names config refers to that are missing or only in the environment. */
  list(c: Config) {
    const uses = secretUses(c, this.o.authMode);
    const names = new Set([...this.cache.keys(), ...uses.keys()]);
    return [...names].sort().map((name) => {
      const m = this.cache.get(name);
      return { name, from: this.where(name), createdAt: m?.createdAt ?? null, updatedAt: m?.updatedAt ?? null, usedBy: uses.get(name) ?? [] };
    });
  }

  /** Creates a secret. With no value, generates one. Returns the value only when it was generated. */
  async create(name: string, value?: string) {
    if (!SECRET_NAME.test(name)) throw new SecretError(422, "names are upper case letters, digits and underscores, starting with a letter (e.g. JIRA_HOOK_SECRET)");
    await this.load();
    if (this.cache.has(name)) throw new SecretError(409, `${name} already exists; rotate it instead`);
    const v = value ?? generateSecret();
    if (!v) throw new SecretError(422, "the value is empty");
    await this.backend.put(name, v, false);
    await this.load();
    this.onChange({ name, action: "created" });
    return { name, value: value === undefined ? v : undefined };
  }

  async rotate(name: string, value?: string) {
    await this.load();
    if (!this.cache.has(name)) throw new SecretError(404, `${name} is not in the store`);
    const v = value ?? generateSecret();
    if (!v) throw new SecretError(422, "the value is empty");
    await this.backend.put(name, v, true);
    await this.load();
    this.onChange({ name, action: "rotated" });
    return { name, value: value === undefined ? v : undefined };
  }

  async delete(name: string, c: Config) {
    await this.load();
    if (!this.cache.has(name)) throw new SecretError(404, `${name} is not in the store`);
    const used = secretUses(c, this.o.authMode).get(name);
    if (used?.length) throw new SecretError(409, `${name} is used by ${used.map((u) => u.where).join(", ")}; change those first`, used);
    await this.backend.remove(name);
    await this.load();
    this.onChange({ name, action: "deleted" });
    return { name, deleted: true };
  }
}

export function createSecretStore(o: { backend: "file" | "gcp"; path: string; gcpProject?: string; gcpPrefix?: string; authMode?: string }) {
  // The Google Secret Manager backend is an optional integration, used by the GCP deployment.
  const backend = o.backend === "gcp" ? new GcpSecretBackend({ project: o.gcpProject ?? "", prefix: o.gcpPrefix, endpoint: process.env.WB_GCP_SECRETS_ENDPOINT }) : new FileSecretBackend(o.path);
  if (o.backend === "gcp" && !o.gcpProject) throw new Error("WB_SECRETS=gcp needs WB_GCP_PROJECT");
  return new SecretStore(backend, { authMode: o.authMode });
}
