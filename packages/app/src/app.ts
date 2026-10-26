import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { sections, sourceKind, type ConfigStore, type Section } from "./engine/config.ts";
import type { DB } from "./engine/db.ts";
import type { Engine } from "./engine/engine.ts";
import type { Launcher, Notifier, RequestRow } from "./engine/types.ts";
import { Admin, AdminError } from "./lib/admin.ts";
import type { Identity, Role } from "./lib/auth.ts";
import type { LayoutStore, UpsertWindow } from "./lib/layout.ts";
import type { ServiceBackend } from "./lib/services.ts";
import { claudeConfigPath } from "./lib/claude-trust.ts";
import { setupItems } from "./lib/setup.ts";
import { findServers, importServer, type FoundServer } from "./lib/mcp-import.ts";
import type { ActivityClock } from "./lib/activity.ts";
import { TerminalError, type Terminals } from "./lib/terminals.ts";
import { DocError, docRoots, readDoc, resolveDoc } from "./lib/docs.ts";
import { SecretError, type SecretStore } from "./lib/secrets.ts";
import type { SkillStore } from "./lib/skills.ts";
import { displayPath, nextRun, sampleDelivery, signDelivery, sourceEmits, sourceFeedsRule } from "./lib/workflows.ts";
import type { queries } from "./queries.ts";
import type { Maintenance } from "./lib/maintenance.ts";

export interface AppContext {
  /** Drain and backup for updates (also on the management API). */
  maintenance?: Maintenance;
  db: DB;
  config: ConfigStore;
  engine: Engine;
  launcher: Launcher;
  notifier: Notifier;
  layout: LayoutStore;
  skills: SkillStore;
  q: ReturnType<typeof queries>;
  services: ServiceBackend;
  zellij: { list(): Promise<{ name: string; exited: boolean; created: string }[]> };
  termLogin: { cookieValid(c?: string): Promise<boolean>; login(email: string, readOnly?: boolean): Promise<string>; reconcile(keep: (email: string, readOnly: boolean) => boolean): Promise<string[]> };
  /** Proves who is calling (AUTH_MODE) and their role. peer is the request's TCP peer address. */
  identify: (h: Record<string, string | string[] | undefined>, peer?: string) => Promise<Identity | null>;
  /** For the Setup page: is the data on a volume, and is Claude Code installed and signed in. */
  setupFacts?: () => { dataMount: { expected: boolean; mounted: boolean }; claude: { installed: boolean; signedIn: boolean; how: string | null } };
  /** WB_BOOTSTRAP_ADMIN: the first admin, named by whoever deployed the box. */
  bootstrapAdmin?: string;
  /** OIDC mode only: the box's own sign-in. */
  login?: {
    loginStart(redirectUri: string, next: string): Promise<{ url: string; cookie: { name: string; value: string; maxAge: number } }>;
    loginFinish(q: Record<string, string | undefined>, h: Record<string, string | string[] | undefined>): Promise<{ identity: Identity; next: string; session: { name: string; value: string; maxAge: number }; clear: string }>;
  } | null;
  authMode: string;
  adminToken: string;
  /** Where test deliveries are posted: the local webhook listener. */
  hooksListenerUrl: string;
  /** Fallback base for webhook URLs when settings.publicHooksUrl is empty (http://localhost:8080 in dev). */
  defaultHooksUrl: string | null;
  secrets: (name: string) => string | undefined;
  /** Create, rotate, delete and list secrets. Null in tests that do not need it. */
  secretStore?: SecretStore | null;
  allowedEmails: string[] | null;
  /** Revokes terminal tokens of people who lost access (or became viewers). */
  reconcileTokens?: () => Promise<string[]>;
  ensureSessions: () => Promise<string[]>;
  /** Extra state for /api/status: config folder git state, cold start, limits, editor... */
  /** The box's config folder (the workspace): its git state and a manual sync. */
  workspace: { sync(reason?: string): Promise<void>; state: object } | null;
  status: () => Record<string, unknown>;
  deployKey: { ensure(): string; publicKey(): string | null } | null;
  /** Last activity by kind, for /api/health and the management API. */
  activity?: ActivityClock | null;
  version?: string;
  /** Where to look for a project-scope .mcp.json (the workspace). */
  workspaceDir?: string;
  /** Terminals people open. Null in tests that do not need it. */
  terminals?: Terminals | null;
  reloadSchedules: () => void;
  serveStatic?: { dir: string } | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A plain page for sign-in problems; the app itself needs a signed-in person. */
function signInPage(message: string, again = true) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>body{font:15px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fafafa;color:#111}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}main{max-width:28rem;padding:24px}a{color:inherit}</style></head>
<body><main><h1 style="font-size:18px">Workbench</h1><p>${esc(message)}</p>${again ? '<p><a href="/auth/login">Sign in</a></p>' : ""}</main></body></html>`;
}

const RANK = { viewer: 0, member: 1, admin: 2 } as const;
/**
 * The role each API call needs. Reading is open to everyone signed in. Members run things: runs,
 * requests, terminals (and canvases, which change over Yjs). Everything that changes how the box
 * works (settings, workflows, sources, secrets, services) is for admins.
 */
export function requiredRole(method: string, path: string): Role {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "viewer";
  if (path === "/api/term-login") return "viewer";
  if (path === "/api/setup/claim-admin") return "member";
  if (/^\/api\/(runs(\/\d+\/(steer|stop|resume))?|requests\/\d+\/answer|terminals(\/[^/]+)?|sessions\/ensure)$/.test(path)) return "member";
  return "admin";
}

export const parseReq = (r: RequestRow | undefined) =>
  r && { ...r, actions: JSON.parse(r.actions), answer: r.answer ? JSON.parse(r.answer) : null, tool: r.tool ? JSON.parse(r.tool) : null };

function fail(reply: FastifyReply, e: unknown, code = 400) {
  if (e instanceof AdminError) return reply.code(e.status).send({ error: e.message, errors: e.details });
  return reply.code(code).send({ error: (e as Error).message ?? String(e) });
}

const param = (req: FastifyRequest, k: string) => String((req.params as Record<string, string>)[k]);

function sameSecret(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function createApp(ctx: AppContext): Promise<{ pub: FastifyInstance; loc: FastifyInstance }> {
  const { engine, config, q, notifier } = ctx;
  const liveRunCount = () => (ctx.db.prepare("select count(*) n from runs where status in ('starting','working','blocked')").get() as { n: number }).n;
  const admin = new Admin(config, ctx.skills, () => q.openCounts());

  /** Requests in a deleted workflow can never be answered (their buttons and skill are gone), so close them. */
  const closeOrphanRequests = (group: string) => {
    const n = ctx.db.prepare("update requests set status = 'closed' where group_id = ? and status = 'open'").run(group).changes;
    if (n) notifier.signal("requests", { group });
    return n;
  };

  const changed = (what: string, actor: string, payload: Record<string, unknown> = {}) => {
    engine.emit({ source: actor.endsWith("(admin tools)") ? "agent" : "ui-action", type: "config.changed", summary: `${actor} changed ${what}`, actor, payload });
    notifier.signal("config", { what });
  };

  /** Webhook URLs are <publicHooksUrl><path>. The box cannot see its own public address, so a person sets it. */
  const hooksBase = () => config.get().settings.publicHooksUrl || ctx.defaultHooksUrl || null;
  const hooksBaseFrom = () => (config.get().settings.publicHooksUrl ? "settings" : ctx.defaultHooksUrl ? "default" : null);
  const settingsView = () => ({
    settings: (config.raw().settings ?? {}) as Record<string, unknown>,
    effective: config.get().settings,
    hooksBase: hooksBase(),
    hooksBaseFrom: hooksBaseFrom(),
    deployKey: ctx.deployKey?.publicKey() ?? null,
    workspace: ctx.workspace?.state ?? null,
  });
  const sourceView = (id: string, base: string | null) => {
    const c = config.get();
    const s = c.sources[id]!;
    const summary = q.deliverySummary()[id];
    return {
      id,
      source: (config.raw().sources as Record<string, unknown>)[id],
      kind: sourceKind(s),
      /** For url-token sources the path ends in <token>: the value is never shown after it was generated. */
      url: s.path && base ? `${base}${displayPath(s)}` : null,
      displayPath: s.path ? displayPath(s) : null,
      emits: sourceEmits(s),
      nextRun: nextRun(s),
      feeds: c.rules.filter((r) => sourceFeedsRule(s, r)).map((r) => ({ id: r.id, on: r.on, group: r.group })),
      deliveries: summary ?? null,
    };
  };

  async function testSend(id: string, triggerRules: boolean) {
    const s = config.get().sources[id];
    if (!s) throw new AdminError(404, `no source ${id}`);
    if (!s.path) throw new AdminError(422, "schedules have no endpoint; they fire on their own");
    const sample = sampleDelivery(id, s);
    const raw = JSON.stringify(sample.body);
    const signed = signDelivery(s, raw, { "content-type": "application/json", ...sample.headers, ...(triggerRules ? {} : { "x-wb-test": "1" }) }, s.verify && s.verify.kind !== "none" ? ctx.secrets(s.verify.secret) : undefined);
    const headers = signed.headers;
    const r = await fetch(`${ctx.hooksListenerUrl}${signed.path}`, { method: "POST", headers, body: raw, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: r.status, body, sent: { headers: Object.keys(headers), body: sample.body } };
  }

  // ─────────────────────────── browser API (behind IAP) ───────────────────────────
  const pub = Fastify({ logger: { level: "warn" }, trustProxy: true, forceCloseConnections: true });
  await pub.register(cookie);
  // The door (Caddy) asks this before serving terminals, sync, previews, code-server and devtools.
  pub.get("/auth/check", async (req, reply) => {
    const user = await ctx.identify(req.headers, req.socket.remoteAddress);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    reply.header("X-Wb-Email", user.email);
    reply.header("X-Wb-Role", user.role);
    // Caddy passes the original URI; opening a terminal counts as someone at the keyboard.
    const uri = String(req.headers["x-forwarded-uri"] ?? "");
    if (uri.startsWith("/term")) ctx.activity?.touch("terminal");
    return { ok: true };
  });

  // OIDC: the box's own sign-in. The callback address is publicAppUrl, or this request's own address.
  const callbackUrl = (req: FastifyRequest) => {
    const base = config.get().settings.publicAppUrl || `${String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0]}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
    return `${base}/auth/callback`;
  };
  const secureCookies = () => (config.get().settings.publicAppUrl ?? "").startsWith("https://");
  pub.get("/auth/login", async (req, reply) => {
    if (!ctx.login) return reply.code(404).send({ error: "this box does not use its own sign-in" });
    try {
      const r = await ctx.login.loginStart(callbackUrl(req), String((req.query as { next?: string }).next ?? "/"));
      reply.setCookie(r.cookie.name, r.cookie.value, { path: "/auth", httpOnly: true, sameSite: "lax", secure: secureCookies(), maxAge: r.cookie.maxAge });
      return reply.redirect(r.url);
    } catch (e) {
      return reply.code(500).type("text/html").send(signInPage(`Sign-in is not available: ${(e as Error).message}`));
    }
  });
  pub.get("/auth/callback", async (req, reply) => {
    if (!ctx.login) return reply.code(404).send({ error: "this box does not use its own sign-in" });
    try {
      const r = await ctx.login.loginFinish(req.query as Record<string, string>, req.headers);
      reply.clearCookie(r.clear, { path: "/auth" });
      reply.setCookie(r.session.name, r.session.value, { path: "/", httpOnly: true, sameSite: "lax", secure: secureCookies(), maxAge: r.session.maxAge });
      engine.emit({ source: "ui-action", type: "person.signed-in", summary: `${r.identity.name} signed in`, actor: r.identity.email, payload: { via: r.identity.via } });
      return reply.redirect(r.next);
    } catch (e) {
      return reply.code(403).type("text/html").send(signInPage((e as Error).message));
    }
  });
  pub.get("/auth/logout", async (_req, reply) => {
    reply.clearCookie("wb-session", { path: "/" });
    return reply.type("text/html").send(signInPage("You are signed out.", true));
  });

  pub.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url === "/api/health") return;
    const user = await ctx.identify(req.headers, req.socket.remoteAddress);
    if (!user) return reply.code(401).send({ error: "unauthenticated", ...(ctx.login ? { login: "/auth/login" } : {}) });
    (req as any).user = user;
    const need = requiredRole(req.method, req.url.split("?")[0]!);
    if (RANK[user.role] < RANK[need])
      return reply.code(403).send({ error: need === "admin" ? `only admins can do this; you are a ${user.role}` : "viewers can look but not change anything" });
    ctx.activity?.touch(req.method === "GET" ? "view" : "person");
  });
  const me = (req: FastifyRequest) => (req as any).user as Identity;
  const author = (req: FastifyRequest) => ({ name: me(req).name, email: me(req).email });

  // Open to the door without sign-in: a host checks it to decide when the box can sleep.
  pub.get("/api/health", async () => ({
    ok: true,
    version: ctx.version ?? "dev",
    box: config.get().settings.box,
    ...(ctx.activity?.summary(liveRunCount()) ?? {}),
  }));
  pub.get("/api/me", async (req) => ({ ...me(req), authMode: ctx.authMode }));
  pub.get("/api/meta", async () => ({ hooksBase: hooksBase(), hooksBaseFrom: hooksBaseFrom(), authMode: ctx.authMode, box: config.get().settings.box }));
  pub.get("/api/settings", async () => settingsView());
  // The first admin: whoever completes the Setup page, unless the deployment named one.
  const hasAdmin = () => !!ctx.bootstrapAdmin || config.get().settings.access.users.some((u) => u.role === "admin");
  pub.get("/api/setup", async () => {
    const ws = ctx.workspace?.state as { remote: string | null; lastPushAt: string | null; lastError: string | null } | undefined;
    const box = ctx.setupFacts?.() ?? { dataMount: { expected: false, mounted: false }, claude: { installed: false, signedIn: false, how: null } };
    // Only deliveries to sources that still exist, and saves rather than deletions, count.
    const sources = config.get().sources;
    const accepted = (ctx.db.prepare("select source, at from deliveries where status = 'accepted' and source is not null order by id desc limit 200").all() as { source: string; at: string }[]).find((d) => sources[d.source]);
    const saved = ctx.db.prepare("select summary, at from events where type = 'config.changed' and (summary like '%workflow%' or summary like '%rules for%') and summary not like '%(deleted)%' order by id desc limit 1").get() as { summary: string; at: string } | undefined;
    const items = setupItems({
      authMode: ctx.authMode,
      dataMount: box.dataMount,
      hooksBase: hooksBase(),
      hooksBaseFrom: hooksBaseFrom() as "settings" | "default" | null,
      claude: box.claude,
      workspace: ws ? { remote: ws.remote, lastPushAt: ws.lastPushAt, lastError: ws.lastError } : null,
      hasAdmin: hasAdmin(),
      missingSecrets: (ctx.secretStore?.list(config.get()) ?? []).filter((s) => !s.from && s.usedBy.length).map((s) => ({ name: s.name, usedBy: s.usedBy.map((u) => u.where) })),
      acceptedDelivery: accepted ?? null,
      workflowSaved: saved ?? null,
    });
    return { items, complete: items.every((i) => i.done || i.optional), hasAdmin: hasAdmin(), bootstrapAdmin: ctx.bootstrapAdmin ?? null, authMode: ctx.authMode };
  });
  pub.get("/api/setup/admin", async () => ({ hasAdmin: hasAdmin(), bootstrapAdmin: ctx.bootstrapAdmin ?? null }));
  pub.post("/api/setup/claim-admin", async (req, reply) => {
    if (hasAdmin()) return reply.code(409).send({ error: ctx.bootstrapAdmin ? `the first admin is ${ctx.bootstrapAdmin}, set by the deployment` : "this box already has an admin" });
    try {
      const email = me(req).email;
      admin.as(author(req), (a) =>
        a.setSection("settings", { ...(config.raw().settings ?? {}), access: { ...((config.raw().settings as any)?.access ?? {}), users: [...(config.get().settings.access.users ?? []), { email, role: "admin" }] } }, `Make ${email} the first admin`),
      );
      changed(`people (${email} is the first admin)`, email, { section: "settings.access" });
      return { ok: true, role: "admin" };
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.put("/api/settings", async (req, reply) => {
    try {
      const value = { ...((req.body as any)?.value ?? {}) };
      // The box id is assigned once and never edited.
      value.box = { ...(value.box ?? {}), id: config.get().settings.box.id };
      admin.as(author(req), (a) => a.setSection("settings", value, "Update settings"));
    } catch (e) {
      return fail(reply, e);
    }
    changed("settings", me(req).email, { section: "settings" });
    ctx.reloadSchedules();
    return settingsView();
  });
  pub.get("/api/status", async () => ({ configErrors: config.errors(), configPath: config.path, ...ctx.status() }));
  pub.post("/api/workspace/sync", async () => {
    await ctx.workspace?.sync("manual");
    return ctx.workspace?.state ?? null;
  });
  pub.get("/api/keys/deploy", async () => ({ publicKey: ctx.deployKey?.publicKey() ?? null }));
  pub.post("/api/keys/deploy", async () => ({ publicKey: ctx.deployKey?.ensure() ?? null }));

  // runs
  pub.get("/api/runs", async (req) => q.runs(req.query as any));
  pub.get("/api/runs/search", async (req) => q.searchRuns(req.query as any));
  pub.get("/api/runs/:id", async (req, reply) => {
    const id = Number(param(req, "id"));
    const run = engine.getRun(id);
    if (!run) return reply.code(404).send({ error: "not found" });
    return {
      run,
      trigger: run.trigger_event_id ? q.event(run.trigger_event_id) : null,
      timeline: q.timeline(id),
      requests: q.requestsForRun(id).map(parseReq),
      children: q.childRuns(id),
      parent: run.parent_run_id ? engine.getRun(run.parent_run_id) : null,
      alive: await ctx.launcher.alive(run).catch(() => false),
    };
  });
  pub.post("/api/runs", async (req, reply) => {
    const b = req.body as any;
    try {
      const ev = engine.emit({ source: "ui-action", type: "run.requested", summary: `Started by ${me(req).name}`, actor: me(req).email, payload: { group: b.group } }).event;
      return engine.startRun({ group: b.group, prompt: b.prompt, title: b.title || undefined, mode: b.mode, goal: b.goal || undefined, actor: me(req).email, trigger_event_id: ev.id });
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.post("/api/runs/:id/steer", async (req, reply) => {
    try {
      await engine.steer(Number(param(req, "id")), String((req.body as any)?.text ?? ""), me(req).email);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.post("/api/runs/:id/stop", async (req, reply) => {
    try {
      await engine.stopRun(Number(param(req, "id")), (req.body as any)?.final === "done" ? "done" : "stopped");
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.post("/api/runs/:id/resume", async (req, reply) => {
    try {
      return await engine.resumeRun(Number(param(req, "id")), me(req).email);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
  pub.post("/api/runs/cleanup", async (req) => ({ deleted: await engine.cleanupSessions(Number((req.body as any)?.hours ?? config.get().settings.sessionRetentionHours)) }));

  // requests
  pub.get("/api/requests", async (req) => q.requests(req.query as any).map(parseReq));
  pub.get("/api/requests/counts", async () => {
    const counts = q.openCounts();
    return { open: Object.values(counts).reduce((a, b) => a + b, 0), byGroup: counts };
  });
  pub.get("/api/requests/:id", async (req, reply) => parseReq(engine.getRequest(Number(param(req, "id")))) ?? reply.code(404).send({ error: "not found" }));
  pub.post("/api/requests/:id/answer", async (req, reply) => {
    const b = req.body as any;
    try {
      return parseReq(await engine.answerRequest(Number(param(req, "id")), { action_id: b.action_id, input: b.input ?? {}, actor: me(req).email }));
    } catch (e) {
      return fail(reply, e);
    }
  });

  // activity
  // documents: markdown files a Document window shows
  pub.get("/api/docs", async (req, reply) => {
    try {
      return readDoc(String((req.query as any).path ?? ""), docRoots(ctx.workspaceDir));
    } catch (e) {
      if (e instanceof DocError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  pub.get("/api/events", async (req) => q.events(req.query as any));
  pub.get("/api/events/facets", async () => q.eventFacets());

  // workflows (groups), their rules, and skills
  pub.get("/api/groups", async () => {
    const counts = q.openCounts();
    return Object.entries(config.get().groups).map(([id, g]) => ({ id, title: g.title, description: g.description, autonomy: g.autonomy, open: counts[id] ?? 0 }));
  });
  pub.get("/api/workflows", async () => admin.listWorkflows());
  pub.get("/api/workflows/:id", async (req, reply) => {
    try {
      return admin.getWorkflow(param(req, "id"));
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.post("/api/workflows", async (req, reply) => {
    try {
      const r = admin.as(author(req), (a) => a.createWorkflow(req.body as any));
      changed(`workflow ${r.id} (created)`, me(req).email, { workflow: r.id });
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.put("/api/workflows/:id", async (req, reply) => {
    try {
      const r = admin.as(author(req), (a) => a.putWorkflow(param(req, "id"), (req.body as any).group));
      changed(`workflow ${r.id}`, me(req).email, { workflow: r.id });
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.put("/api/workflows/:id/rules", async (req, reply) => {
    try {
      const r = admin.as(author(req), (a) => a.setWorkflowRules(param(req, "id"), (req.body as any).rules));
      changed(`rules for ${r.id}`, me(req).email, { workflow: r.id });
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.delete("/api/workflows/:id", async (req, reply) => {
    try {
      const r = admin.as(author(req), (a) => a.deleteWorkflow(param(req, "id"), { deleteSkill: (req.query as any).skill === "1" }));
      const closed = closeOrphanRequests(r.deleted);
      changed(`workflow ${r.deleted} (deleted)`, me(req).email, { ...r, closedRequests: closed });
      return { ...r, closedRequests: closed };
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.get("/api/skills", async () => ctx.skills.list());
  pub.get("/api/skills/:name", async (req, reply) => {
    try {
      return admin.readSkill(param(req, "name"));
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.put("/api/skills/:name", async (req, reply) => {
    try {
      admin.as(author(req), (a) => a.write(param(req, "name"), String((req.body as any)?.content ?? "")));
      changed(`skill ${param(req, "name")}`, me(req).email, { skill: param(req, "name") });
      return admin.readSkill(param(req, "name"));
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.delete("/api/skills/:name", async (req, reply) => {
    try {
      const r = admin.as(author(req), (a) => a.deleteSkill(param(req, "name")));
      changed(`skill ${r.deleted} (deleted)`, me(req).email, r);
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });

  // MCP servers configured for the box's Claude Code user, for importing into workflows
  const mcpSources = () => findServers({ claudeConfig: claudeConfigPath(), workspace: ctx.workspaceDir ?? "." });
  pub.get("/api/mcp/claude-code", async () => ({ configPath: claudeConfigPath(), servers: mcpSources().servers }));
  pub.post("/api/workflows/:id/mcp/import", async (req, reply) => {
    const id = param(req, "id");
    // save: false returns the definitions (secrets already stored) for a form to add and save itself.
    const b = (req.body ?? {}) as { keys?: string[]; names?: Record<string, string>; save?: boolean };
    if (!config.get().groups[id]) return reply.code(404).send({ error: `no workflow ${id}` });
    if (!ctx.secretStore) return reply.code(503).send({ error: "no secrets store" });
    const { servers, raw } = mcpSources();
    const picked = (b.keys ?? []).map((k) => servers.find((s) => s.key === k));
    if (!picked.length || picked.some((s) => !s)) return reply.code(422).send({ error: "pick servers from the list" });
    const out: Record<string, unknown> = {};
    const created: string[] = [];
    const reused: string[] = [];
    try {
      for (const s of picked as FoundServer[]) {
        const as = (b.names?.[s.key] ?? s.name).trim();
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(as)) return reply.code(422).send({ error: `${as}: server names are letters, digits, - and _` });
        const r = await importServer(raw.get(s.key)!, as, ctx.secretStore);
        out[as] = r.def;
        created.push(...r.created);
        reused.push(...r.reused);
      }
      if (b.save !== false) admin.as(author(req), (a) => a.addMcpServers(id, out));
    } catch (e) {
      return fail(reply, e);
    }
    for (const n of created) engine.emit({ source: "ui-action", type: "secret.created", summary: `${me(req).name} created secret ${n} (imported with an MCP server)`, actor: me(req).email, payload: { name: n } });
    if (b.save !== false) changed(`workflow ${id} (imported MCP servers ${Object.keys(out).join(", ")})`, me(req).email, { workflow: id });
    return { imported: Object.keys(out), servers: out, secretsCreated: created, secretsReused: reused };
  });

  // terminals people open (standing ones come from config, run ones belong to runs)
  // Zellij's web client recreates a session it cannot find, so a window still showing an ended
  // terminal would bring it back. Every window on it, on every canvas, moves to the standing shell.
  const moveWindowsOffSession = (name: string) => {
    for (const w of ctx.layout.windows()) if (w.type === "terminal" && w.props?.session === name) ctx.layout.upsertWindow({ ...w, props: { ...w.props, session: "shell" } } as any);
  };
  const termFail = (reply: FastifyReply, e: unknown) => (e instanceof TerminalError ? reply.code(e.status).send({ error: e.message }) : fail(reply, e));
  const mayManage = (req: FastifyRequest, createdBy: string) => createdBy === me(req).email || me(req).role === "admin";
  pub.get("/api/terminals", async (req) => (ctx.terminals ? ctx.terminals.grouped(me(req).email) : { standing: [], yours: [], others: [], runs: [], limit: 0, used: 0 }));
  pub.post("/api/terminals", async (req, reply) => {
    if (!ctx.terminals) return reply.code(503).send({ error: "terminals are not available" });
    try {
      const t = await ctx.terminals.create((req.body ?? {}) as any, { email: me(req).email, name: me(req).name });
      engine.emit({ source: "ui-action", type: "terminal.opened", summary: `${me(req).name} opened terminal ${t.title}`, actor: me(req).email, payload: { name: t.name, cwd: t.cwd } });
      notifier.signal("runs", { what: "terminals" });
      return reply.code(201).send(t);
    } catch (e) {
      return termFail(reply, e);
    }
  });
  pub.patch("/api/terminals/:name", async (req, reply) => {
    const t = ctx.terminals?.get(param(req, "name"));
    if (!t) return reply.code(404).send({ error: "no such terminal" });
    if (!mayManage(req, t.created_by)) return reply.code(403).send({ error: `only ${t.created_by_name ?? t.created_by} or an admin can rename it` });
    try {
      const r = ctx.terminals!.rename(t.name, String((req.body as any)?.title ?? ""));
      notifier.signal("runs", { what: "terminals" });
      return r;
    } catch (e) {
      return termFail(reply, e);
    }
  });
  pub.delete("/api/terminals/:name", async (req, reply) => {
    const t = ctx.terminals?.get(param(req, "name"));
    if (!t) return reply.code(404).send({ error: "no such terminal (standing and run sessions are closed elsewhere)" });
    if (!mayManage(req, t.created_by)) return reply.code(403).send({ error: `only ${t.created_by_name ?? t.created_by} or an admin can close it` });
    try {
      const r = await ctx.terminals!.close(t.name, me(req).email);
      moveWindowsOffSession(t.name);
      engine.emit({ source: "ui-action", type: "terminal.closed", summary: `${me(req).name} closed terminal ${t.title}`, actor: me(req).email, payload: { name: t.name } });
      notifier.signal("runs", { what: "terminals" });
      return r;
    } catch (e) {
      return termFail(reply, e);
    }
  });

  // secrets: names, dates and uses only; a value leaves the server once, when it was generated
  const secretFail = (reply: FastifyReply, e: unknown) =>
    e instanceof SecretError ? reply.code(e.status).send({ error: e.message, usedBy: e.details }) : fail(reply, e);
  const secretEvent = (action: string, name: string, req: FastifyRequest) =>
    engine.emit({ source: "ui-action", type: `secret.${action}`, summary: `${me(req).name} ${action} secret ${name}`, actor: me(req).email, payload: { name } });
  pub.get("/api/secrets", async () => ({ backend: ctx.secretStore?.backend.kind ?? null, secrets: ctx.secretStore?.list(config.get()) ?? [] }));
  pub.post("/api/secrets", async (req, reply) => {
    if (!ctx.secretStore) return reply.code(503).send({ error: "no secrets store" });
    const b = (req.body ?? {}) as { name?: string; value?: string; generate?: boolean };
    try {
      const r = await ctx.secretStore.create(String(b.name ?? ""), b.generate ? undefined : String(b.value ?? ""));
      secretEvent("created", r.name, req);
      notifier.signal("config", { what: "secrets" });
      return reply.code(201).send(r);
    } catch (e) {
      return secretFail(reply, e);
    }
  });
  pub.post("/api/secrets/:name/rotate", async (req, reply) => {
    if (!ctx.secretStore) return reply.code(503).send({ error: "no secrets store" });
    const b = (req.body ?? {}) as { value?: string; generate?: boolean };
    try {
      const r = await ctx.secretStore.rotate(param(req, "name"), b.generate ? undefined : String(b.value ?? ""));
      secretEvent("rotated", r.name, req);
      notifier.signal("config", { what: "secrets" });
      return r;
    } catch (e) {
      return secretFail(reply, e);
    }
  });
  pub.delete("/api/secrets/:name", async (req, reply) => {
    if (!ctx.secretStore) return reply.code(503).send({ error: "no secrets store" });
    try {
      const r = await ctx.secretStore.delete(param(req, "name"), config.get());
      secretEvent("deleted", r.name, req);
      notifier.signal("config", { what: "secrets" });
      return r;
    } catch (e) {
      return secretFail(reply, e);
    }
  });

  // sources
  pub.get("/api/sources", async () => {
    return Object.keys(config.get().sources).map((id) => sourceView(id, hooksBase()));
  });
  pub.get("/api/sources/:id/deliveries", async (req) => q.deliveries(param(req, "id"), Number((req.query as any).limit ?? 20)));
  pub.put("/api/sources/:id", async (req, reply) => {
    try {
      admin.as(author(req), (a) => a.upsertSource(param(req, "id"), (req.body as any).source));
      changed(`source ${param(req, "id")}`, me(req).email, { source: param(req, "id") });
      ctx.reloadSchedules();
      return sourceView(param(req, "id"), hooksBase());
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.delete("/api/sources/:id", async (req, reply) => {
    try {
      const r = admin.as(author(req), (a) => a.deleteSource(param(req, "id")));
      changed(`source ${r.deleted} (deleted)`, me(req).email, r);
      ctx.reloadSchedules();
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });
  pub.post("/api/sources/:id/test", async (req, reply) => {
    try {
      return await testSend(param(req, "id"), (req.body as any)?.triggerRules === true);
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // raw config (advanced JSON views) and services config
  pub.get("/api/config", async () => ({ raw: config.raw(), sections }));
  pub.put("/api/config/:section", async (req, reply) => {
    const section = param(req, "section") as Section;
    if (!sections.includes(section)) return reply.code(404).send({ error: "unknown section" });
    try {
      // The JSON tab shows the raw file, so what it sends is exactly what the person wants kept.
      admin.as(author(req), (a) => a.setSection(section, (req.body as any).value, undefined, true));
    } catch (e) {
      return fail(reply, e);
    }
    changed(section, me(req).email, { section });
    if (section === "sources") ctx.reloadSchedules();
    return { ok: true };
  });

  // services
  pub.get("/api/services", async () => ctx.services.list());
  pub.post("/api/services/:id/restart", async (req, reply) => {
    const s = (await ctx.services.list()).find((x) => x.id === param(req, "id"));
    if (!s) return reply.code(404).send({ error: "unknown service" });
    if (!s.canRestart) return reply.code(409).send({ error: `${s.title} cannot be restarted from here` });
    try {
      await ctx.services.restart(s.id);
      engine.emit({ source: "ui-action", type: "service.restarted", summary: `${me(req).name} restarted ${s.title}`, actor: me(req).email, payload: { service: s.id } });
      notifier.signal("services", { id: s.id });
      return { ok: true };
    } catch (e) {
      return fail(reply, e, 500);
    }
  });
  pub.get("/api/services/:id/logs", async (req, reply) => {
    return reply.type("text/plain").send(await ctx.services.logs(param(req, "id"), Number((req.query as any).lines ?? 200)));
  });

  // terminals
  pub.get("/api/sessions", async () => (await ctx.zellij.list()).filter((s) => !s.exited));
  pub.post("/api/sessions/ensure", async () => ({ created: await ctx.ensureSessions() }));
  pub.post("/api/term-login", async (req, reply) => {
    // Viewers watch; everyone else types. A Zellij cookie is reused only if it was issued for the same kind.
    const kind = me(req).role === "viewer" ? "watch" : "type";
    const had = req.headers.cookie?.match(/(?:^|;\s*)wb-term-kind=([a-z]+)/)?.[1];
    if (had === kind && (await ctx.termLogin.cookieValid(req.headers.cookie))) return { ok: true, reused: true, kind };
    try {
      const zellijCookie = await ctx.termLogin.login(me(req).email, kind === "watch");
      reply.header("set-cookie", [zellijCookie, `wb-term-kind=${kind}; Path=/; SameSite=Lax; HttpOnly`]);
      return { ok: true, reused: false, kind };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // built frontend; the theme cookie is applied server-side so the first paint is right
  if (ctx.serveStatic && existsSync(ctx.serveStatic.dir)) {
    await pub.register(fastifyStatic, { root: ctx.serveStatic.dir, index: false, wildcard: false });
    const html = readFileSync(join(ctx.serveStatic.dir, "index.html"), "utf8");
    const page = async (req: FastifyRequest, reply: FastifyReply) => {
      const theme = (req as any).cookies?.["wb-theme"];
      const cls = theme === "dark" ? "dark" : theme === "light" ? "light" : "";
      return reply.type("text/html").header("cache-control", "no-store").send(html.replace('<html lang="en">', `<html lang="en" class="${cls}" data-theme="${theme ?? "system"}">`));
    };
    pub.get("/", page);
    pub.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api/") ? page(req, reply) : reply.code(404).send({ error: "not found" })));
  }

  // ─────────────────────────── loopback API (agents, hooks, wb) ───────────────────────────
  const loc = Fastify({ logger: { level: "warn" }, bodyLimit: 5 * 1024 * 1024, forceCloseConnections: true });

  loc.post("/events", async (req) => {
    const b = req.body as any;
    const r = engine.emit({ source: b.source ?? "agent", type: b.type, summary: b.summary, actor: b.actor, payload: b.payload, run_id: b.run_id, dedupe_key: b.dedupe_key, test: b.test === true });
    return { event_id: r.event.id, duplicate: r.duplicate, runs: r.runs.map((x) => x.id) };
  });
  loc.post("/deliveries", async (req) => {
    q.recordDelivery(req.body as any);
    ctx.activity?.touch("delivery");
    notifier.signal("events", { delivery: true });
    return { ok: true };
  });
  loc.post("/notes", async (req) => {
    const b = req.body as any;
    return engine.emit({ source: "agent", type: "agent.note", summary: String(b.text).slice(0, 400), run_id: b.run_id ?? null, payload: { text: b.text } }).event;
  });

  loc.get("/requests", async (req) => q.requests(req.query as any).map(parseReq));
  loc.get("/requests/:id", async (req, reply) => parseReq(engine.getRequest(Number(param(req, "id")))) ?? reply.code(404).send({ error: "not found" }));
  loc.post("/requests", async (req, reply) => {
    const b = req.body as any;
    try {
      return parseReq(engine.createRequest({ group: b.group, title: b.title, body: b.body, actions: b.actions, mode: b.mode ?? "deferred", origin_run_id: b.run_id ?? null }));
    } catch (e) {
      return fail(reply, e);
    }
  });
  loc.patch("/requests/:id", async (req, reply) => {
    try {
      return parseReq(engine.updateRequest(Number(param(req, "id")), req.body as any));
    } catch (e) {
      return fail(reply, e);
    }
  });
  loc.get("/requests/:id/answer", async (req, reply) => {
    const id = Number(param(req, "id"));
    const qs = req.query as any;
    try {
      const r = qs.wait ? await engine.waitForAnswer(id, Math.min(Number(qs.timeout ?? 25), 55) * 1000) : engine.getRequest(id);
      if (!r) return reply.code(404).send({ error: "not found" });
      return { ...parseReq(r), decision: r.mode === "guard" ? engine.guardDecision(r) : undefined };
    } catch (e) {
      return fail(reply, e, 404);
    }
  });

  loc.post("/runs", async (req, reply) => {
    const b = req.body as any;
    try {
      return engine.startRun({ group: b.group, prompt: b.prompt, title: b.title, mode: b.mode, goal: b.goal, actor: b.actor ?? "agent" });
    } catch (e) {
      return fail(reply, e);
    }
  });
  loc.get("/runs", async (req) => q.runs(req.query as any));
  loc.get("/runs/:id", async (req, reply) => engine.getRun(Number(param(req, "id"))) ?? reply.code(404).send({ error: "not found" }));
  loc.patch("/runs/:id", async (req) => {
    const id = Number(param(req, "id"));
    const b = req.body as any;
    if (b.result) ctx.db.prepare("update runs set result = ? where id = ?").run(String(b.result), id);
    if (b.status) engine.setStatus(id, b.status);
    notifier.signal("runs", { id });
    return engine.getRun(id);
  });
  loc.post("/runs/:id/statusline", async (req) => {
    const b = req.body as any;
    engine.recordCost(Number(param(req, "id")), typeof b.cost_usd === "number" ? b.cost_usd : undefined, b.model);
    return { ok: true };
  });
  loc.post("/hooks/claude/:event", async (req) => engine.hook(Number((req.query as any).run), param(req, "event"), (req.body as any) ?? {}));

  loc.get("/services", async () => ctx.services.list());
  loc.post("/services/:id/restart", async (req, reply) => {
    const s = (await ctx.services.list()).find((x) => x.id === param(req, "id"));
    if (!s) return reply.code(404).send({ error: "unknown service" });
    await ctx.services.restart(s.id);
    notifier.signal("services", { id: s.id });
    return { ok: true };
  });
  loc.get("/services/:id/logs", async (req, reply) => {
    return reply.type("text/plain").send(await ctx.services.logs(param(req, "id"), Number((req.query as any).lines ?? 200)));
  });
  loc.post("/sessions/ensure", async () => ({ created: await ctx.ensureSessions() }));
  loc.post("/sessions/cleanup", async (req) => ({ deleted: await engine.cleanupSessions(Number((req.body as any)?.hours ?? config.get().settings.sessionRetentionHours)) }));
  loc.post("/tokens/reconcile", async () => ({ revoked: await ctx.reconcileTokens?.() ?? [] }));
  loc.get("/config", async () => config.get());
  loc.get("/groups", async () => config.get().groups);

  // ── admin: setup tools for the human `claude` session only ──
  // Every route needs the admin token from data/admin.token. Runs never get it: their MCP server and
  // `wb` refuse admin commands when WB_RUN_ID is set, and their settings deny reading the token file.
  await loc.register(
    async (a) => {
      a.addHook("onRequest", async (req, reply) => {
        const h = req.headers["x-wb-admin-token"];
        if (!sameSecret(Array.isArray(h) ? h[0] : h, ctx.adminToken)) return reply.code(403).send({ error: "admin token required; admin tools are only for the human claude session" });
      });
      const actor = "claude session (admin tools)";
      // Terminals opened by a person carry WB_ACTOR, which wb and the MCP server send as x-wb-actor.
      const adminAuthor = (req: FastifyRequest) => {
        const h = req.headers["x-wb-actor"];
        // WB_ACTOR is "Name <email>" (set in terminals people open) or a bare email.
        const v = (Array.isArray(h) ? h[0] : h)?.trim() ?? "";
        const m = v.match(/^(.*?)\s*<([^\s@<>]+@[^\s@<>]+)>$/) ?? (/^[^\s@]+@[^\s@]+$/.test(v) ? [v, "", v] : null);
        if (!m) return { name: "Admin tools", email: "admin-tools@workbench.local" };
        return { name: `${m[1] || m[2]} (admin tools)`, email: m[2]! };
      };
      const wrap = (fn: (req: FastifyRequest) => unknown, what?: (req: FastifyRequest) => string) => async (req: FastifyRequest, reply: FastifyReply) => {
        try {
          const r = await admin.as(adminAuthor(req), () => fn(req));
          if (what) changed(what(req), actor);
          return r;
        } catch (e) {
          return fail(reply, e);
        }
      };
      a.get("/workflows", wrap(() => admin.listWorkflows()));
      a.get("/workflows/:id", wrap((req) => admin.getWorkflow(param(req, "id"))));
      a.put("/workflows/:id", wrap((req) => {
        const b = req.body as any;
        const id = param(req, "id");
        if (!config.get().groups[id]) return admin.createWorkflow({ id, group: b.group, skill: b.skill, rule: b.rule });
        return admin.putWorkflow(id, b.group);
      }, (req) => `workflow ${param(req, "id")}`));
      a.delete("/workflows/:id", wrap((req) => {
        const r = admin.deleteWorkflow(param(req, "id"), { deleteSkill: (req.query as any).skill === "1" });
        return { ...r, closedRequests: closeOrphanRequests(r.deleted) };
      }, (req) => `workflow ${param(req, "id")} (deleted)`));
      a.get("/skills", wrap(() => ctx.skills.list()));
      a.get("/skills/:name", wrap((req) => admin.readSkill(param(req, "name"))));
      a.put("/skills/:name", wrap((req) => (admin.write(param(req, "name"), String((req.body as any)?.content ?? "")), admin.readSkill(param(req, "name"))), (req) => `skill ${param(req, "name")}`));
      a.get("/rules", wrap(() => admin.listRules()));
      a.put("/rules/:id", wrap((req) => admin.upsertRule({ ...(req.body as any), id: param(req, "id") }), (req) => `rule ${param(req, "id")}`));
      a.delete("/rules/:id", wrap((req) => admin.deleteRule(param(req, "id")), (req) => `rule ${param(req, "id")} (deleted)`));
      a.get("/sources", wrap(() => Object.keys(config.get().sources).map((id) => sourceView(id, hooksBase()))));
      a.get("/settings", wrap(() => settingsView()));
      a.get("/terminals", wrap(async (req) => (ctx.terminals ? ctx.terminals.grouped(adminAuthor(req).email) : null)));
      a.post("/terminals", async (req, reply) => {
        if (!ctx.terminals) return reply.code(503).send({ error: "terminals are not available" });
        const who = adminAuthor(req);
        try {
          const t = await ctx.terminals.create((req.body ?? {}) as any, { email: who.email, name: who.name.replace(/ \(admin tools\)$/, "") });
          engine.emit({ source: "agent", type: "terminal.opened", summary: `${who.name} opened terminal ${t.title}`, actor: who.email, payload: { name: t.name, cwd: t.cwd } });
          notifier.signal("runs", { what: "terminals" });
          return reply.code(201).send(t);
        } catch (e) {
          return termFail(reply, e);
        }
      });
      a.delete("/terminals/:name", async (req, reply) => {
        if (!ctx.terminals) return reply.code(503).send({ error: "terminals are not available" });
        try {
          const r = await ctx.terminals.close(param(req, "name"), adminAuthor(req).email);
          moveWindowsOffSession(param(req, "name"));
          notifier.signal("runs", { what: "terminals" });
          return r;
        } catch (e) {
          return termFail(reply, e);
        }
      });
      a.get("/secrets", wrap(() => ctx.secretStore?.list(config.get()) ?? []));
      const secretWrap = (fn: (req: FastifyRequest, s: SecretStore) => Promise<unknown>, what: (req: FastifyRequest) => string) => async (req: FastifyRequest, reply: FastifyReply) => {
        if (!ctx.secretStore) return reply.code(503).send({ error: "no secrets store" });
        try {
          const r = await fn(req, ctx.secretStore);
          engine.emit({ source: "agent", type: "secret.changed", summary: `${actor} ${what(req)}`, actor, payload: { name: param(req, "name") || (req.body as any)?.name } });
          notifier.signal("config", { what: "secrets" });
          return r;
        } catch (e) {
          return secretFail(reply, e);
        }
      };
      a.post("/secrets", secretWrap((req, s) => { const b = req.body as any; return s.create(String(b?.name ?? ""), b?.generate ? undefined : String(b?.value ?? "")); }, (req) => `created secret ${(req.body as any)?.name}`));
      a.post("/secrets/:name/rotate", secretWrap((req, s) => { const b = req.body as any; return s.rotate(param(req, "name"), b?.generate ? undefined : String(b?.value ?? "")); }, (req) => `rotated secret ${param(req, "name")}`));
      a.delete("/secrets/:name", secretWrap((req, s) => s.delete(param(req, "name"), config.get()), (req) => `deleted secret ${param(req, "name")}`));
      a.put("/settings", wrap((req) => {
        const value = { ...((req.body as any)?.value ?? req.body ?? {}) };
        value.box = { ...(value.box ?? {}), id: config.get().settings.box.id };
        admin.setSection("settings", value, "Update settings");
        ctx.reloadSchedules();
        return settingsView();
      }, () => "settings"));
      a.put("/sources/:id", wrap((req) => {
        const r = admin.upsertSource(param(req, "id"), (req.body as any).source ?? req.body);
        ctx.reloadSchedules();
        return r;
      }, (req) => `source ${param(req, "id")}`));
      a.delete("/sources/:id", wrap((req) => admin.deleteSource(param(req, "id")), (req) => `source ${param(req, "id")} (deleted)`));
      a.post("/sources/:id/test", wrap((req) => testSend(param(req, "id"), (req.body as any)?.triggerRules === true)));
      // Drain and backup, for people updating a box by hand (`wb admin drain`, `wb admin backup`).
      const maint = () => {
        if (!ctx.maintenance) throw new AdminError(503, "maintenance is not available");
        return ctx.maintenance;
      };
      a.get("/drain", wrap(() => maint().drainStatus()));
      a.post("/drain", wrap((req) => {
        const was = maint().draining;
        const r = maint().drain(adminAuthor(req).email, Number((req.body as any)?.timeoutSeconds ?? 900));
        if (!was) engine.emit({ source: "agent", type: "box.draining", summary: `${adminAuthor(req).name} is draining the box for an update; queued runs wait`, actor });
        return r;
      }));
      a.post("/undrain", wrap((req) => {
        const was = maint().draining;
        const r = maint().undrain();
        if (was) engine.emit({ source: "agent", type: "box.undrained", summary: `${adminAuthor(req).name} ended the drain; queued runs start again`, actor });
        return r;
      }));
      a.get("/backups", wrap(() => maint().listBackups()));
      a.post("/backup", wrap(async () => {
        const b = await maint().backup();
        engine.emit({ source: "agent", type: "box.backup", summary: `Backup ${b.name} (${b.contents.join(", ")})`, actor, payload: { path: b.path } });
        return b;
      }));
      a.get("/canvases", wrap(async () => (await ctx.layout.ready(), ctx.layout.canvases())));
      a.put("/canvases/:id", wrap(async (req) => (await ctx.layout.ready(), ctx.layout.upsertCanvas({ id: param(req, "id"), title: (req.body as any).title, locked: (req.body as any).locked })), (req) => `canvas ${param(req, "id")}`));
      a.delete("/canvases/:id", wrap(async (req) => {
        await ctx.layout.ready();
        if (ctx.layout.canvases().length <= 1) throw new AdminError(409, "cannot delete the last canvas");
        return { deleted: ctx.layout.deleteCanvas(param(req, "id")) };
      }, (req) => `canvas ${param(req, "id")} (deleted)`));
      a.get("/windows", wrap(async (req) => (await ctx.layout.ready(), ctx.layout.windows((req.query as any).canvas))));
      a.put("/windows/:id", wrap(async (req) => (await ctx.layout.ready(), ctx.layout.upsertWindow({ ...(req.body as UpsertWindow), id: param(req, "id") })), (req) => `window ${param(req, "id")}`));
      a.post("/windows", wrap(async (req) => (await ctx.layout.ready(), ctx.layout.upsertWindow(req.body as UpsertWindow)), () => "a window"));
      // `wb open FILE`: a Document window for FILE beside the terminal it was typed in (by its Zellij
      // session), or on the first canvas. Opening the same file again brings its window back.
      a.post("/docs/open", async (req, reply) => {
        const b = (req.body ?? {}) as { path?: string; session?: string; title?: string };
        try {
          const path = resolveDoc(String(b.path ?? ""), docRoots(ctx.workspaceDir));
          await ctx.layout.ready();
          const all = ctx.layout.windows();
          const term = b.session ? all.find((w) => w.type === "terminal" && w.props.session === b.session) : undefined;
          const canvasId = term?.canvasId ?? ctx.layout.canvases()[0]?.id;
          if (!canvasId) return reply.code(409).send({ error: "there is no canvas to open it on" });
          const same = all.find((w) => w.canvasId === canvasId && w.type === "doc" && w.props.path === path);
          const title = b.title || `Document · ${path.split("/").pop()}`;
          const place = term && !same ? { x: term.x + term.w + 20, y: term.y, w: 560, h: Math.max(360, term.h) } : {};
          const win = ctx.layout.upsertWindow({ id: same?.id, canvasId, type: "doc", title, props: { path }, ...place });
          changed(`a document window (${path})`, adminAuthor(req).name);
          return reply.code(same ? 200 : 201).send(win);
        } catch (e) {
          if (e instanceof DocError) return reply.code(e.status).send({ error: e.message });
          return fail(reply, e);
        }
      });
      a.delete("/windows/:id", wrap(async (req) => (await ctx.layout.ready(), { deleted: ctx.layout.deleteWindow(param(req, "id")) }), (req) => `window ${param(req, "id")} (deleted)`));
    },
    { prefix: "/admin" },
  );

  return { pub, loc };
}
