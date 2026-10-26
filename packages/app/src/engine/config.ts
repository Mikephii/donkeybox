import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { z } from "zod";

// ───────────── sources ─────────────

/**
 * Who can send which verifier:
 *  hmac       the body is signed with the secret (GitHub; anything that signs bodies)
 *  header     the secret arrives in a header (senders you control, CI, scripts)
 *  url-token  the secret is the last path segment (Jira Cloud system webhooks, anything that cannot set headers)
 *  none       anyone who knows the URL; only for testing
 * Secrets are always referenced by name and resolved from the secrets store, then the environment.
 */
const verify = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hmac"),
    secret: z.string().min(1, "needs a secret name"),
    header: z.string().default("x-hub-signature-256"),
    algorithm: z.enum(["sha256", "sha1"]).default("sha256"),
    prefix: z.string().default("sha256="),
  }),
  z.object({ kind: z.literal("header"), header: z.string().min(1), secret: z.string().min(1, "needs a secret name") }),
  z.object({ kind: z.literal("url-token"), secret: z.string().min(1, "needs a secret name") }),
  z.object({ kind: z.literal("none") }),
]);

export const sourceSchema = z
  .object({
    title: z.string().optional(),
    kind: z.enum(["webhook", "generic", "schedule"]).optional(),
    path: z.string().regex(/^\/hooks\/[a-z0-9][a-z0-9/_-]*$/, "a path under /hooks/, lowercase").optional(),
    verify: verify.optional(),
    adapter: z.enum(["github", "jira"]).optional(),
    map: z
      .object({
        type: z.string().min(1),
        summary: z.string().optional(),
        payload: z.record(z.string(), z.string()).default({}),
      })
      .optional(),
    schedule: z.string().optional(),
    type: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((s, ctx) => {
    const kind = sourceKind(s);
    if (kind === "schedule") {
      if (!s.type) ctx.addIssue({ code: "custom", path: ["type"], message: "schedule sources need an event type" });
      return;
    }
    if (!s.path) ctx.addIssue({ code: "custom", path: ["path"], message: "webhook sources need a path under /hooks/" });
    if (!s.verify) ctx.addIssue({ code: "custom", path: ["verify"], message: "webhook sources need a verifier" });
    if (kind === "generic") {
      if (s.adapter || s.map) ctx.addIssue({ code: "custom", message: "generic sources take events as sent; remove adapter and map" });
      return;
    }
    if (!s.adapter === !s.map) ctx.addIssue({ code: "custom", message: "set exactly one of adapter or map" });
  });

export function sourceKind(s: { kind?: string; schedule?: string }): "webhook" | "generic" | "schedule" {
  if (s.kind === "generic") return "generic";
  if (s.kind === "schedule" || s.schedule) return "schedule";
  return "webhook";
}

// ───────────── workflows (groups) and rules ─────────────

const fieldType = z.union([z.enum(["string", "text", "number", "boolean"]), z.object({ enum: z.array(z.string()).min(1) })]);

export const actionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/, "use lowercase letters, digits, - and _"),
  label: z.string().min(1, "needs a label"),
  style: z.enum(["primary", "secondary", "danger"]).default("secondary"),
  input: z.record(z.string(), fieldType).optional(),
  prompt: z.string().optional(),
});

export const groupSchema = z.object({
  title: z.string().min(1, "needs a name"),
  description: z.string().optional(),
  skill: z.string().optional(),
  autonomy: z.enum(["autonomous", "ask-first", "guarded"]).default("ask-first"),
  guard: z.array(z.string()).default([]),
  notify: z.array(z.string()).default([]),
  actions: z.array(actionSchema).default([]),
  model: z.string().optional(),
  allowedTools: z.array(z.string()).default([]),
  mcpServers: z.record(z.string(), z.unknown()).default({}),
  /**
   * Where runs start: a folder on the box, absolute or relative to the workspace. Empty: a fresh
   * folder per run. The workbench never manages what is in it; a skill says how to use it.
   */
  workdir: z.string().optional(),
  /** Whether runs may use WebSearch and WebFetch. On unless a workflow turns it off. */
  webAccess: z.boolean().default(true),
  /** More folders runs may read and write (passed to Claude Code with --add-dir). */
  addDirs: z.array(z.string()).default([]),
  parallel: z.boolean().default(false),
  /** More skill folders (each holding <name>/SKILL.md) linked into this workflow's runs. Relative paths are from the workspace. */
  extraSkillDirs: z.array(z.string()).default([]),
  /** Claude Code plugin directories passed to this workflow's runs with --plugin-dir. */
  pluginDirs: z.array(z.string()).default([]),
});

export const ruleSchema = z.object({
  id: z.string().min(1, "needs an id"),
  on: z.string().min(1, "needs an event type"),
  filter: z.record(z.string(), z.unknown()).default({}),
  prompt: z.string().min(1, "needs a prompt"),
  group: z.string(),
  mode: z.enum(["interactive", "print"]).default("interactive"),
  goal: z.string().optional(),
  title: z.string().optional(),
  enabled: z.boolean().default(true),
});

// ───────────── services and terminals ─────────────

/** Extra processes run next to the workbench (dev servers, workers). The workbench's own services are built in. */
export const serviceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  run: z
    .object({
      cmd: z.string(),
      args: z.array(z.string()).default([]),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
  probe: z.object({ port: z.number() }).optional(),
});

export const TERMINAL_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;

export const terminalSchema = z.object({
  name: z.string().regex(TERMINAL_NAME, "lowercase letters, digits and -, up to 31 characters"),
  title: z.string().optional(),
  description: z.string().optional(),
  /** "workspace", or a folder (absolute, or relative to the workspace). */
  cwd: z.string().default("workspace"),
  command: z.string().optional(),
  layout: z.enum(["shell", "services"]).default("shell"),
});

// ───────────── settings ─────────────

const role = z.enum(["admin", "member", "viewer"]);

const baseUrl = z
  .string()
  .regex(/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/, "a URL such as https://hooks.example.com")
  .refine((u) => !u.endsWith("/"), "leave off the trailing slash");

export const settingsSchema = z.object({
  box: z.object({ id: z.string().optional(), name: z.string().min(1).default("Workbench") }).prefault({}),
  /** Where webhooks reach this box from the internet, e.g. https://hooks.example.com. The box cannot see this itself. */
  publicHooksUrl: baseUrl.optional(),
  /** The address people open, e.g. https://workbench.example.com. Used for links in notifications and the OIDC callback. */
  publicAppUrl: baseUrl.optional(),
  /** Git URL the box's config folder (the workspace, never your code) pushes to and pulls from (ssh with the box's deploy key, or https). */
  workspaceRemote: z
    .string()
    .optional()
    .refine((u) => !u || /^(git@[^:\s]+:[^\s]+|ssh:\/\/\S+|https:\/\/\S+|file:\/\/\S+|\/\S+)$/.test(u), "a git URL such as git@github.com:org/workspace.git"),
  defaultModel: z.string().optional(),
  sessionRetentionHours: z.number().min(0).default(72),
  timezone: z
    .string()
    .optional()
    .refine((tz) => !tz || isTimeZone(tz), "not an IANA time zone, e.g. Australia/Sydney"),
  /** Where the app reads and writes workflow skills. Relative to the workspace. */
  skillsDir: z.string().default(".claude/skills"),
  codeServer: z.boolean().default(false),
  scheduler: z.object({ mode: z.enum(["internal", "external"]).default("internal"), secret: z.string().default("SCHEDULE_SECRET") }).prefault({}),
  access: z
    .object({
      users: z.array(z.object({ email: z.string().min(3), role })).default([]),
      domains: z.array(z.string()).default([]),
      defaultRole: role.default("member"),
    })
    .prefault({}),
  limits: z
    .object({
      maxConcurrentRuns: z.number().int().min(1).default(4),
      maxRunSessionHours: z.number().min(1).default(24),
      diskWarnPercent: z.number().min(1).max(100).default(80),
      diskStopPercent: z.number().min(1).max(100).default(95),
      maxTerminals: z.number().int().min(1).default(12),
    })
    .prefault({}),
  doors: z
    .object({
      appHosts: z.array(z.string()).default([]),
      hooksHosts: z.array(z.string()).default([]),
      /** public: any address may reach the app door (identity still required). private: only privateCidrs. */
      appAccess: z.enum(["public", "private", "both"]).default("public"),
      privateCidrs: z.array(z.string()).default(["127.0.0.1/32", "::1/128"]),
    })
    .prefault({}),
  auth: z
    .object({
      proxy: z
        .object({
          emailHeader: z.string().default("X-Forwarded-Email"),
          nameHeader: z.string().optional(),
          /** Secret the proxy sends in X-Workbench-Proxy-Secret. Empty disables the check (then trustedCidrs must be set). */
          secret: z.string().default("PROXY_SECRET"),
          trustedCidrs: z.array(z.string()).default([]),
        })
        .prefault({}),
      oidc: z
        .object({
          issuer: z.string().optional(),
          clientId: z.string().optional(),
          clientSecret: z.string().default("OIDC_CLIENT_SECRET"),
          scopes: z.string().default("openid email profile"),
          sessionHours: z.number().min(1).default(168),
        })
        .prefault({}),
    })
    .prefault({}),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ───────────── the whole file ─────────────

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    settings: settingsSchema.prefault({}),
    sources: z.record(z.string(), sourceSchema).default({}),
    groups: z.record(z.string(), groupSchema).default({}),
    rules: z.array(ruleSchema).default([]),
    services: z.array(serviceSchema).default([]),
    terminals: z.array(terminalSchema).default([]),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.rules.forEach((r, i) => {
      if (!c.groups[r.group]) ctx.addIssue({ code: "custom", path: ["rules", i, "group"], message: `unknown group ${r.group}` });
      if (ids.has(r.id)) ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: `duplicate rule id ${r.id}` });
      ids.add(r.id);
    });
    const paths = new Set<string>();
    for (const [k, s] of Object.entries(c.sources)) {
      if (!s.path) continue;
      if (paths.has(s.path)) ctx.addIssue({ code: "custom", path: ["sources", k, "path"], message: `duplicate path ${s.path}` });
      paths.add(s.path);
    }
    const terms = new Set<string>();
    c.terminals.forEach((t, i) => {
      if (terms.has(t.name)) ctx.addIssue({ code: "custom", path: ["terminals", i, "name"], message: `duplicate terminal ${t.name}` });
      terms.add(t.name);
    });
    const svc = new Set<string>();
    c.services.forEach((s, i) => {
      if (svc.has(s.id)) ctx.addIssue({ code: "custom", path: ["services", i, "id"], message: `duplicate service ${s.id}` });
      svc.add(s.id);
    });
  });

export type Config = z.infer<typeof configSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Terminal = z.infer<typeof terminalSchema>;
export type Role = z.infer<typeof role>;
export type Section = "settings" | "sources" | "groups" | "rules" | "services" | "terminals";
export const sections: Section[] = ["settings", "sources", "groups", "rules", "services", "terminals"];

/** Older files used other names for the same things; read them as today's. */
export function normalizeLegacy(raw: Record<string, any>): Record<string, any> {
  const out = { ...raw };
  if (out.sources && typeof out.sources === "object") {
    out.sources = Object.fromEntries(
      Object.entries(out.sources as Record<string, any>).map(([k, s]) => {
        if (!s?.verify) return [k, s];
        const v = { ...s.verify };
        if (v.kind === "github-hmac") v.kind = "hmac";
        if (v.kind === "header-secret") v.kind = "header";
        return [k, { ...s, verify: v }];
      }),
    );
  }
  // Managed code repos were removed: what agents do with code is up to their skills.
  delete out.repos;
  if (out.groups && typeof out.groups === "object")
    out.groups = Object.fromEntries(Object.entries(out.groups as Record<string, any>).map(([k, g]) => {
      if (!g || typeof g !== "object" || !("repo" in g)) return [k, g];
      const { repo: _repo, ...rest } = g;
      return [k, rest];
    }));
  if (Array.isArray(out.services)) {
    out.services = out.services.map((s: any) => {
      if (!s || typeof s !== "object") return s;
      const { local, unit: _unit, ...rest } = s;
      return local && !rest.run ? { ...rest, run: local } : rest;
    });
  }
  return out;
}

export function parseConfig(raw: unknown): { ok: true; config: Config } | { ok: false; errors: string[] } {
  const r = configSchema.safeParse(raw && typeof raw === "object" ? normalizeLegacy(raw as Record<string, any>) : raw);
  if (r.success) return { ok: true, config: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

/**
 * Puts back what a newer build wrote and this one does not know. `prev` is the file before the write,
 * `known` is what this build parsed out of it (parsing drops unknown keys), `next` is what is about to
 * be written. Any key in `prev` that `known` lacks, and that `next` lacks at the same place, is
 * copied into `next`. Records match by key and lists by `id`, `name` or `email`; a thing removed in
 * `next` takes its unknown keys with it.
 */
export function carryUnknown(prev: unknown, known: unknown, next: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(prev) && isObj(next)) {
    if (!isObj(known)) return next;
    const out: Record<string, unknown> = { ...next };
    for (const [k, v] of Object.entries(prev)) {
      if (!(k in known)) {
        if (!(k in next)) out[k] = v;
      } else if (k in next) out[k] = carryUnknown(v, known[k], next[k]);
    }
    return out;
  }
  if (Array.isArray(prev) && Array.isArray(next) && Array.isArray(known) && prev.length === known.length) {
    const idOf = (v: unknown) => (isObj(v) ? (["id", "name", "email"].map((k) => v[k]).find((x) => typeof x === "string") as string | undefined) : undefined);
    return next.map((item) => {
      const id = idOf(item);
      const i = id === undefined ? -1 : prev.findIndex((p) => idOf(p) === id);
      return i < 0 ? item : carryUnknown(prev[i], known[i], item);
    });
  }
  return next;
}

/**
 * The parts of an invalid file that are valid: entries of sources, groups, rules, services and
 * terminals with errors are left out, and settings with errors fall back to their defaults. Used at
 * start when the file has never been valid, so one entry this build cannot read (written by a newer
 * build, say) does not take every workflow down with it.
 */
export function parseValidParts(raw: Record<string, any>): Config | null {
  let cur: Record<string, any> = structuredClone(normalizeLegacy(raw));
  for (let pass = 0; pass < 5; pass++) {
    const r = configSchema.safeParse(cur);
    if (r.success) return r.data;
    for (const issue of r.error.issues) {
      const [section, key, ...rest] = issue.path as (string | number)[];
      if (section === undefined) return null;
      const node = cur[section];
      if (section === "settings" && key !== undefined) {
        // Drop the deepest setting named, so its default applies.
        const path = [key, ...rest];
        let parent: any = node;
        for (const p of path.slice(0, -1)) parent = parent?.[p];
        if (parent && typeof parent === "object") delete parent[path.at(-1) as string];
        else delete node[key];
      } else if (Array.isArray(node) && typeof key === "number") node[key] = undefined;
      else if (node && typeof node === "object" && key !== undefined) delete node[key];
      else delete cur[section];
    }
    for (const k of ["rules", "services", "terminals"]) if (Array.isArray(cur[k])) cur[k] = cur[k].filter((x: unknown) => x !== undefined);
  }
  return null;
}

export interface WriteInfo {
  message: string;
  /** The value is exactly what the person wrote (the JSON tab, which shows the raw file): keep nothing extra. */
  exact?: boolean;
  author?: { name: string; email: string };
  /** Extra paths in the workspace that belong to the same change (e.g. a skill written with its workflow). */
  paths?: string[];
}

export type WriteResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Workflows config, read from the workspace's config.json with mtime caching. The file is the source
 * of truth. If it becomes invalid (a hand edit, a bad pull) the last good config stays in force and
 * `errors()` reports what is wrong; the app never goes down over it. Every write validates the whole
 * file first, writes atomically, then calls onWrite (the workspace commits it).
 */
export class ConfigStore {
  path: string;
  onWrite: ((info: WriteInfo) => void) | null = null;
  private cache: { mtime: number; config: Config; raw: Record<string, unknown> } | null = null;
  private lastError: { mtime: number; errors: string[] } | null = null;

  constructor(path: string, opts: { onWrite?: (info: WriteInfo) => void } = {}) {
    this.path = path;
    this.onWrite = opts.onWrite ?? null;
  }

  get(): Config {
    return this.load().config;
  }
  raw(): Record<string, unknown> {
    return this.load().raw;
  }
  /** Validation errors in the file on disk, or null when it is valid. */
  errors(): string[] | null {
    this.load();
    return this.lastError?.errors ?? null;
  }

  private load() {
    let mtime = -1;
    try {
      mtime = existsSync(this.path) ? statSync(this.path).mtimeMs : -1;
    } catch {}
    if (this.cache && this.cache.mtime === mtime) return this.cache;
    if (this.lastError && this.lastError.mtime === mtime && this.cache) return this.cache;
    let errors: string[];
    if (mtime < 0) {
      errors = [`(root): ${this.path} does not exist`];
    } else {
      try {
        const raw = JSON.parse(readFileSync(this.path, "utf8"));
        const parsed = parseConfig(raw);
        if (parsed.ok) {
          this.cache = { mtime, config: parsed.config, raw };
          this.lastError = null;
          return this.cache;
        }
        errors = parsed.errors;
      } catch (e) {
        errors = [`(root): not valid JSON: ${(e as Error).message}`];
      }
    }
    this.lastError = { mtime, errors };
    if (!this.cache) {
      // Never valid since start: run with the parts that are valid (or an empty config) so the app can
      // still show what is wrong. Saves stay refused until the file is fixed.
      let raw: Record<string, unknown> = {};
      try {
        raw = JSON.parse(readFileSync(this.path, "utf8"));
      } catch {}
      const partial = raw && typeof raw === "object" ? parseValidParts(raw as Record<string, any>) : null;
      const empty = parseConfig({});
      this.cache = { mtime: -2, config: partial ?? (empty as { config: Config }).config, raw: partial ? raw : {} };
    }
    return this.cache;
  }

  setSection(section: Section, value: unknown, info?: WriteInfo): WriteResult {
    return this.update((raw) => ({ ...raw, [section]: value }), info ?? { message: `Update ${section}` });
  }

  /**
   * Change any part of the raw file in one step. The whole result is validated before anything is
   * written, and the write is atomic, so a multi-section change (a group plus its rule) never lands half-done.
   * Refused while the file on disk is invalid, so a UI save never overwrites a hand edit in progress.
   */
  update(fn: (raw: Record<string, any>) => Record<string, any>, info: WriteInfo = { message: "Update config" }): WriteResult {
    const broken = this.errors();
    if (broken) return { ok: false, errors: ["(root): config.json has errors; fix the file first", ...broken] };
    const prev = this.raw();
    let next = fn(structuredClone(prev));
    // Keep what a newer build wrote that this one does not know, so saving here never deletes it.
    if (!info.exact) next = carryUnknown(normalizeLegacy(prev), configSchema.safeParse(normalizeLegacy(prev)).data, next) as Record<string, any>;
    const parsed = parseConfig(next);
    if (!parsed.ok) return parsed;
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    renameSync(tmp, this.path);
    this.cache = null;
    this.lastError = null;
    this.onWrite?.(info);
    return { ok: true };
  }
}
