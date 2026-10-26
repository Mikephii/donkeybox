import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigStore } from "../src/engine/config.ts";
import { COMPAT_FLOOR, openDb, SCHEMA_VERSION, type MigrateResult } from "../src/engine/db.ts";
import { Maintenance } from "../src/lib/maintenance.ts";
import { releaseManifest } from "../src/release.ts";
import { ActivityClock } from "../src/lib/activity.ts";
import { Admin } from "../src/lib/admin.ts";
import { FileSecretBackend, SecretStore } from "../src/lib/secrets.ts";
import { SkillStore } from "../src/lib/skills.ts";
import { SupportAccess } from "../src/lib/support.ts";
import { managementApp } from "../src/management.ts";

const TOKEN = "m".repeat(40);
function build() {
  const dir = mkdtempSync(join(tmpdir(), "wb-mgmt-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ settings: { box: { id: "box_abc", name: "Acme" }, auth: { proxy: { secret: "PROXY_SECRET" } } } }));
  mkdirSync(join(dir, "skills"));
  const config = new ConfigStore(join(dir, "config.json"));
  let dbState: MigrateResult | null = null;
  const db = openDb(":memory:", { onMigrate: (r) => (dbState = r) });
  const manifest = releaseManifest("1.2.3");
  mkdirSync(join(dir, "internal"));
  const maintenance = new Maintenance({
    db, dataDir: join(dir, "internal"), workspaceDir: join(dir, "skills"), secretsPath: join(dir, "secrets.json"), manifest, box: () => "box_abc",
    liveRuns: () => (db.prepare("select count(*) n from runs where status in ('starting','working','blocked')").get() as { n: number }).n,
    queuedRuns: () => 0,
  });
  const events: { type: string; summary: string }[] = [];
  const support = new SupportAccess(db);
  support.onEvent = (type, g) => events.push({ type, summary: g.email });
  const secrets = new SecretStore(new FileSecretBackend(join(dir, "secrets.json")), { env: {} });
  const app = managementApp({
    token: TOKEN, version: "1.2.3", authMode: "proxy", config, db, admin: new Admin(config, new SkillStore(join(dir, "skills")), () => ({})), activity: new ActivityClock(),
    secrets, support, limits: () => ({ maxConcurrentRuns: 4 }), emit: (e) => events.push(e),
    manifest, dbState: () => dbState, maintenance,
  });
  return { app, config, db, events, secrets, support, dir, maintenance };
}
const auth = { authorization: `Bearer ${TOKEN}` };

describe("management API", () => {
  it("refuses anything without the management token", async () => {
    const { app } = build();
    expect((await app.inject({ url: "/v1/info" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/info", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/info", headers: { authorization: `Bearer ${TOKEN}x` } })).statusCode).toBe(401);
  });

  it("reports version, box, health with last activity, and usage", async () => {
    const { app, db } = build();
    expect((await app.inject({ url: "/v1/info", headers: auth })).json()).toMatchObject({ version: "1.2.3", schemaVersion: SCHEMA_VERSION, box: { id: "box_abc", name: "Acme" } });
    db.prepare("insert into runs (group_id, title, prompt, session_id, status, cost_usd) values ('g','t','p','s','done',0.5), ('g','t','p','s2','failed',0.25)").run();
    const u = (await app.inject({ url: "/v1/usage", headers: auth })).json();
    expect(u).toMatchObject({ runs: { total: 2, byStatus: { done: 1, failed: 1 } }, costUsd: 0.75 });
    const h = (await app.inject({ url: "/v1/health", headers: auth })).json();
    expect(h).toMatchObject({ ok: true, liveRuns: 0, box: { id: "box_abc" } });
    expect(h).toHaveProperty("lastActivity");
  });

  it("sets the allow list and merges settings without touching the box id, committing as the management API", async () => {
    const { app, config } = build();
    const a = await app.inject({ method: "PUT", url: "/v1/access", headers: auth, payload: { users: [{ email: "ann@acme.dev", role: "admin" }], domains: ["acme.dev"] } });
    expect(a.statusCode).toBe(200);
    expect(config.get().settings.access).toMatchObject({ users: [{ email: "ann@acme.dev", role: "admin" }], domains: ["acme.dev"], defaultRole: "member" });
    const s = await app.inject({ method: "PATCH", url: "/v1/settings", headers: auth, payload: { box: { id: "box_hacked", name: "Acme Ops" }, limits: { maxConcurrentRuns: 2 } } });
    expect(s.statusCode).toBe(200);
    expect(config.get().settings.box).toEqual({ id: "box_abc", name: "Acme Ops" });
    expect(config.get().settings.limits.maxConcurrentRuns).toBe(2);
    expect(config.get().settings.access.users).toHaveLength(1);
    const bad = await app.inject({ method: "PATCH", url: "/v1/settings", headers: auth, payload: { limits: { maxConcurrentRuns: 0 } } });
    expect(bad.statusCode).toBe(422);
  });

  it("lists schedule sources and the scheduler setting, for a host that runs them", async () => {
    const { app, config } = build();
    const raw = config.raw() as Record<string, any>;
    const w = config.update(() => ({
      ...raw,
      settings: { ...raw.settings, scheduler: { mode: "external" }, timezone: "Australia/Sydney" },
      sources: { nightly: { title: "Nightly", schedule: "0 2 * * *", type: "housekeeping.nightly" }, gh: { title: "GitHub", path: "/hooks/gh", verify: { kind: "hmac", secret: "GH_SECRET" }, adapter: "github" } },
    }), { message: "test" });
    expect(w.ok, JSON.stringify(w)).toBe(true);
    const r = (await app.inject({ url: "/v1/schedules", headers: auth })).json();
    expect(r).toEqual({ mode: "external", secretName: "SCHEDULE_SECRET", timezone: "Australia/Sydney", schedules: [{ source: "nightly", title: "Nightly", schedule: "0 2 * * *", type: "housekeeping.nightly" }] });
    expect((await app.inject({ url: "/v1/schedules" })).statusCode).toBe(401);
  });

  it("rotates the door secret and returns the new value once", async () => {
    const { app, secrets } = build();
    const r1 = (await app.inject({ method: "POST", url: "/v1/door-secret/rotate", headers: auth })).json();
    expect(r1.name).toBe("PROXY_SECRET");
    expect(secrets.resolve("PROXY_SECRET")).toBe(r1.value);
    const r2 = (await app.inject({ method: "POST", url: "/v1/door-secret/rotate", headers: auth })).json();
    expect(r2.value).not.toBe(r1.value);
    expect(secrets.resolve("PROXY_SECRET")).toBe(r2.value);
  });

  it("support access is off until granted, expires, needs a reason, and every step shows in Activity", async () => {
    const { app, support, events } = build();
    expect(support.active("help@host.dev")).toBeNull();
    expect((await app.inject({ method: "POST", url: "/v1/support", headers: auth, payload: { email: "help@host.dev" } })).statusCode).toBe(422);
    const g = (await app.inject({ method: "POST", url: "/v1/support", headers: auth, payload: { email: "help@host.dev", minutes: 30, reason: "ticket 42", role: "viewer" } })).json();
    expect(g).toMatchObject({ email: "help@host.dev", role: "viewer" });
    expect(Date.parse(g.expires_at) - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(support.active("HELP@host.dev")).toMatchObject({ id: g.id });
    support.used(support.active("help@host.dev")!);
    support.used(support.active("help@host.dev")!);
    await app.inject({ method: "DELETE", url: `/v1/support/${g.id}`, headers: auth });
    expect(support.active("help@host.dev")).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["support.enabled", "support.used", "support.disabled"]);
  });

  it("reports the release manifest and what the data is", async () => {
    const { app } = build();
    const info = (await app.inject({ url: "/v1/info", headers: auth })).json();
    expect(info).toMatchObject({ version: "1.2.3", schemaVersion: SCHEMA_VERSION, compatFloor: COMPAT_FLOOR, minUpgradeFrom: "0.3.0", data: { schemaVersion: SCHEMA_VERSION, compatFloor: COMPAT_FLOOR, newerThanBuild: false } });
    expect(info.capabilities).toEqual(expect.arrayContaining(["drain", "backup", "update-record", "self-restore", "compat-floor"]));
    expect((await app.inject({ url: "/v1/health", headers: auth })).json()).toMatchObject({ ok: true, version: "1.2.3", schemaVersion: SCHEMA_VERSION, drain: { draining: false }, update: null });
  });

  it("drains until live runs finish or the timeout passes, and undrains", async () => {
    const { app, db, events } = build();
    db.prepare("insert into runs (group_id, title, prompt, session_id, status) values ('g','t','p','live','working')").run();
    const d = (await app.inject({ method: "POST", url: "/v1/drain", headers: auth, payload: { timeoutSeconds: 600, by: "ops" } })).json();
    expect(d).toMatchObject({ draining: true, by: "ops", liveRuns: 1, ready: false, reason: null });
    db.prepare("update runs set status = 'done' where session_id = 'live'").run();
    expect((await app.inject({ url: "/v1/drain", headers: auth })).json()).toMatchObject({ draining: true, ready: true, reason: "idle" });
    db.prepare("insert into runs (group_id, title, prompt, session_id, status) values ('g','t','p','live2','working')").run();
    // Draining again moves the deadline; zero seconds means do not wait for live runs.
    expect((await app.inject({ method: "POST", url: "/v1/drain", headers: auth, payload: { timeoutSeconds: 0 } })).json()).toMatchObject({ ready: true, reason: "timeout", by: "ops" });
    expect((await app.inject({ method: "POST", url: "/v1/undrain", headers: auth })).json()).toMatchObject({ draining: false, ready: false });
    expect(events.map((e) => e.type)).toEqual(["box.draining", "box.undrained"]);
  });

  it("takes a backup, records an update against it, and finishes it into the backup folder", async () => {
    const { app, dir } = build();
    const b = await app.inject({ method: "POST", url: "/v1/backup", headers: auth });
    expect(b.statusCode).toBe(201);
    const backup = b.json();
    expect(backup).toMatchObject({ version: "1.2.3", schemaVersion: SCHEMA_VERSION, box: "box_abc" });
    expect(backup.path.startsWith(join(dir, "internal", "backups"))).toBe(true);
    expect((await app.inject({ url: "/v1/backups", headers: auth })).json().backups).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: "/v1/update/begin", headers: auth, payload: { to: { version: "1.3.0" } } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/v1/update/begin", headers: auth, payload: { to: { version: "1.3.0" }, backup: "nope" } })).statusCode).toBe(422);
    const rec = (await app.inject({ method: "POST", url: "/v1/update/begin", headers: auth, payload: { to: { version: "1.3.0", schemaVersion: 9, compatFloor: 1 }, backup: backup.path, by: "ops" } })).json();
    expect(rec).toMatchObject({ state: "pending", from: { version: "1.2.3" }, to: { version: "1.3.0" }, backup: backup.path });
    // Rerun with the same target: the same record.
    expect((await app.inject({ method: "POST", url: "/v1/update/begin", headers: auth, payload: { to: { version: "1.3.0" }, backup: backup.path } })).json().id).toBe(rec.id);
    // Another target while one is in progress: refused.
    expect((await app.inject({ method: "POST", url: "/v1/update/begin", headers: auth, payload: { to: { version: "2.0.0" }, backup: backup.path } })).statusCode).toBe(409);
    expect((await app.inject({ url: "/v1/health", headers: auth })).json().update).toBe("pending");
    const fin = (await app.inject({ method: "POST", url: "/v1/update/finish", headers: auth, payload: { note: "gave up" } })).json();
    expect(fin.record.state).toBe("abandoned");
    expect((await app.inject({ url: "/v1/update", headers: auth })).json().record).toBeNull();
    expect(JSON.parse(readFileSync(join(backup.path, "update.json"), "utf8")).state).toBe("abandoned");
  });
});
