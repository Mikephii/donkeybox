import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { ConfigStore } from "./engine/config.ts";
import type { DB, MigrateResult } from "./engine/db.ts";
import type { ActivityClock } from "./lib/activity.ts";
import type { Admin } from "./lib/admin.ts";
import { AdminError } from "./lib/admin.ts";
import type { SecretStore } from "./lib/secrets.ts";
import type { SupportAccess } from "./lib/support.ts";
import { DEFAULT_DRAIN_SECONDS, UpdateError, type Maintenance } from "./lib/maintenance.ts";
import { sourceKind } from "./engine/config.ts";
import type { ReleaseManifest } from "./release.ts";

/**
 * The management API: what a host or control plane needs to run many boxes without the product
 * knowing about tenants. Its own port, its own token (WB_MANAGEMENT_TOKEN), private network only.
 */
export interface ManagementDeps {
  token: string;
  version: string;
  authMode: string;
  config: ConfigStore;
  db: DB;
  admin: Admin;
  activity: ActivityClock;
  secrets: SecretStore;
  support: SupportAccess;
  limits: () => Record<string, unknown>;
  manifest: ReleaseManifest;
  /** What opening the database found: in particular whether it is from a newer build. */
  dbState: () => MigrateResult | null;
  maintenance: Maintenance;
  emit: (e: { type: string; summary: string; payload?: Record<string, unknown> }) => void;
}

const AUTHOR = { name: "Management API", email: "management@workbench.local" };

function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
  return out;
}

export function managementApp(d: ManagementDeps) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const want = Buffer.from(d.token);
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const got = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (got.length !== want.length || !timingSafeEqual(got, want)) return reply.code(401).send({ error: "unauthorized" });
  });
  const fail = (reply: FastifyReply, e: unknown) =>
    e instanceof AdminError ? reply.code(e.status).send({ error: e.message, errors: e.details }) : reply.code(422).send({ error: (e as Error).message });
  const liveRuns = () => (d.db.prepare("select count(*) n from runs where status in ('starting','working','blocked')").get() as { n: number }).n;

  // The release manifest of the running build, plus what its data is: the update routine's first read.
  const data = () => {
    const s = d.dbState();
    return s ? { schemaVersion: s.newer ? s.from : s.to, compatFloor: s.floor, newerThanBuild: s.newer } : null;
  };
  app.get("/v1/info", async () => ({
    ...d.manifest,
    data: data(),
    box: d.config.get().settings.box,
    authMode: d.authMode,
    startedAt: d.activity.startedAt,
  }));
  app.get("/v1/health", async () => ({
    ok: true,
    version: d.manifest.version,
    schemaVersion: d.manifest.schemaVersion,
    box: d.config.get().settings.box,
    configErrors: d.config.errors(),
    ...d.activity.summary(liveRuns()),
    limits: d.limits(),
    drain: d.maintenance.drainStatus(),
    update: d.maintenance.record()?.state ?? null,
  }));

  // ── updates: drain, backup, and the record an older build reads if it is put back ──
  const updFail = (reply: FastifyReply, e: unknown) => (e instanceof UpdateError ? reply.code(e.status).send({ error: e.message }) : reply.code(500).send({ error: (e as Error).message }));
  app.get("/v1/drain", async () => d.maintenance.drainStatus());
  app.post("/v1/drain", async (req) => {
    const b = (req.body ?? {}) as { timeoutSeconds?: number; by?: string };
    const st = d.maintenance.drainStatus();
    const r = d.maintenance.drain(b.by ?? "management API", b.timeoutSeconds ?? DEFAULT_DRAIN_SECONDS);
    if (!st.draining) d.emit({ type: "box.draining", summary: `Draining for an update (${b.by ?? "management API"}); queued runs wait` });
    return r;
  });
  app.post("/v1/undrain", async () => {
    const was = d.maintenance.draining;
    const r = d.maintenance.undrain();
    if (was) d.emit({ type: "box.undrained", summary: "Drain ended; queued runs start again" });
    return r;
  });
  app.get("/v1/backups", async () => ({ backups: d.maintenance.listBackups() }));
  app.post("/v1/backup", async (_req, reply) => {
    try {
      const b = await d.maintenance.backup();
      d.emit({ type: "box.backup", summary: `Backup ${b.name} (${b.contents.join(", ")})`, payload: { path: b.path } });
      return reply.code(201).send(b);
    } catch (e) {
      return updFail(reply, e);
    }
  });
  app.get("/v1/update", async () => ({ record: d.maintenance.record() }));
  app.post("/v1/update/begin", async (req, reply) => {
    try {
      const b = (req.body ?? {}) as { to?: { version?: string; schemaVersion?: number; compatFloor?: number }; backup?: string; by?: string };
      if (!b.to?.version) return reply.code(422).send({ error: "to.version is required" });
      if (!b.backup) return reply.code(422).send({ error: "backup is required (the path or name POST /v1/backup returned)" });
      return d.maintenance.begin({ to: { ...b.to, version: b.to.version }, backup: b.backup, by: b.by ?? "management API" });
    } catch (e) {
      return updFail(reply, e);
    }
  });
  app.post("/v1/update/finish", async (req) => {
    const b = (req.body ?? {}) as { note?: string };
    const r = d.maintenance.finish(b.note);
    if (r) d.emit({ type: `update.${r.state}`, summary: `Update from ${r.from.version} to ${r.to.version}: ${r.state}`, payload: { id: r.id } });
    return { record: r };
  });
  app.get("/v1/usage", async (req) => {
    const since = String((req.query as { since?: string }).since ?? "1970-01-01");
    const runs = d.db.prepare("select status, count(*) n, coalesce(sum(cost_usd),0) cost from runs where created_at >= ? group by status").all(since) as { status: string; n: number; cost: number }[];
    const byGroup = d.db.prepare("select group_id, count(*) n, coalesce(sum(cost_usd),0) cost from runs where created_at >= ? group by group_id").all(since);
    return {
      since,
      runs: { total: runs.reduce((a, r) => a + r.n, 0), byStatus: Object.fromEntries(runs.map((r) => [r.status, r.n])), byWorkflow: byGroup },
      costUsd: Math.round(runs.reduce((a, r) => a + r.cost, 0) * 10000) / 10000,
      openRequests: (d.db.prepare("select count(*) n from requests where status = 'open'").get() as { n: number }).n,
      limits: d.limits(),
    };
  });
  // Schedule sources, for a host that runs them (settings.scheduler.mode = external): it calls
  // POST /hooks/_schedule/<source> on the hooks door at each time, with the secret named here.
  app.get("/v1/schedules", async () => {
    const c = d.config.get();
    return {
      mode: c.settings.scheduler.mode,
      secretName: c.settings.scheduler.secret,
      timezone: c.settings.timezone ?? null,
      schedules: Object.entries(c.sources)
        .filter(([, s]) => sourceKind(s) === "schedule")
        .map(([id, s]) => ({ source: id, title: s.title ?? id, schedule: s.schedule, type: s.type })),
    };
  });
  // Allow list and roles (settings.access), replaced as a whole.
  app.put("/v1/access", async (req, reply) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      d.admin.as(AUTHOR, (a) => a.setSection("settings", { ...(d.config.raw().settings ?? {}), access: b }, "Set the allow list (management API)"));
      d.emit({ type: "config.changed", summary: "Management API set the allow list", payload: { section: "settings.access" } });
      return d.config.get().settings.access;
    } catch (e) {
      return fail(reply, e);
    }
  });
  // Any settings, merged into what is there. The box id never changes.
  app.patch("/v1/settings", async (req, reply) => {
    try {
      const cur = (d.config.raw().settings ?? {}) as Record<string, any>;
      const next = deepMerge(cur, (req.body ?? {}) as Record<string, any>);
      next.box = { ...(next.box ?? {}), id: d.config.get().settings.box.id };
      d.admin.as(AUTHOR, (a) => a.setSection("settings", next, "Update settings (management API)"));
      d.emit({ type: "config.changed", summary: "Management API changed settings", payload: { keys: Object.keys((req.body ?? {}) as object) } });
      return d.config.get().settings;
    } catch (e) {
      return fail(reply, e);
    }
  });
  // New value for the proxy door's shared secret. Returned once, for the host to give its proxy.
  app.post("/v1/door-secret/rotate", async (req, reply) => {
    const name = d.config.get().settings.auth.proxy.secret;
    if (!name) return reply.code(409).send({ error: "settings.auth.proxy.secret is empty; the proxy door has no shared secret" });
    try {
      const r = d.secrets.where(name) === "store" ? await d.secrets.rotate(name) : await d.secrets.create(name);
      d.emit({ type: "secret.rotated", summary: `Management API rotated the door secret ${name}`, payload: { name } });
      return { name, value: r.value };
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.get("/v1/support", async () => ({ grants: d.support.list() }));
  app.post("/v1/support", async (req, reply) => {
    try {
      const b = (req.body ?? {}) as { email?: string; role?: string; minutes?: number; reason?: string; by?: string };
      return reply.code(201).send(d.support.grant(b as any, b.by ?? "management API"));
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.delete("/v1/support/:id", async (req, reply) => {
    try {
      return d.support.revoke(Number((req.params as { id: string }).id));
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });
  return app;
}
