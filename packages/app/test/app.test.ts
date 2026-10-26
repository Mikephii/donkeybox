import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, requiredRole } from "../src/app.ts";
import { ConfigStore } from "../src/engine/config.ts";
import { openDb } from "../src/engine/db.ts";
import { Engine } from "../src/engine/engine.ts";
import { verify } from "../src/engine/sources.ts";
import { createAuth } from "../src/lib/auth.ts";
import { MemoryLayoutStore } from "../src/lib/layout.ts";
import { NullNotifier } from "../src/lib/signals.ts";
import { FileSecretBackend, SecretStore } from "../src/lib/secrets.ts";
import { SkillStore } from "../src/lib/skills.ts";
import { Terminals } from "../src/lib/terminals.ts";
import { queries } from "../src/queries.ts";
import { baseConfig, FakeLauncher } from "./helpers.ts";

const TOKEN = "t".repeat(64);
let hooksServer: Server | null = null;
let lastHook: { url: string; headers: Record<string, any>; body: string } | null = null;
const termLogins: { email: string; ro: boolean }[] = [];

/** Stands in for Zellij: remembers sessions and the layout each was made from. */
class FakeZellij {
  sessions = new Map<string, { layout: string }>();
  async list() {
    return [...this.sessions.keys()].map((name) => ({ name, exited: false, created: "now" }));
  }
  async createWithLayout(name: string, path: string) {
    this.sessions.set(name, { layout: readFileSync(path, "utf8") });
  }
  async delete(name: string) {
    this.sessions.delete(name);
  }
}

async function build(opts: { defaultHooksUrl?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wb-app-"));
  const configPath = join(dir, "config.json");
  const cfg = structuredClone(baseConfig) as any;
  cfg.sources.nightly = { title: "Nightly", schedule: "0 2 * * *", type: "schedule.nightly" };
  cfg.groups.jira.skill = "jira";
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  const skillsDir = join(dir, "skills");
  mkdirSync(skillsDir);
  const config = new ConfigStore(configPath);
  const db = openDb(":memory:");
  const launcher = new FakeLauncher();
  const notifier = new NullNotifier();
  const engine = new Engine({ db, config, launcher, notifier, runGoal: async () => ({ ok: true, output: "" }) });
  const layout = new MemoryLayoutStore();
  layout.upsertCanvas({ id: "work", title: "Work" });
  if (!hooksServer) {
    hooksServer = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        lastHook = { url: req.url!, headers: req.headers, body };
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => hooksServer!.listen(0, "127.0.0.1", () => r()));
  }
  const port = (hooksServer.address() as { port: number }).port;
  const zj = new FakeZellij();
  const terminals = new Terminals(db, zj as any, config, { layoutsDir: join(dir, "layouts"), workspace: dir });
  const secretStore = new SecretStore(new FileSecretBackend(join(dir, "secrets.json")), { env: { GH_SECRET: "s3cret", DEPLOY_SECRET: "d3ploy" } });
  const { pub, loc } = await createApp({
    db, config, engine, launcher, notifier, layout, skills: new SkillStore(skillsDir), q: queries(db),
    services: { list: async () => [], restart: async () => {}, logs: async () => "" },
    zellij: { list: () => zj.list() },
    terminals,
    workspaceDir: dir,
    termLogin: { cookieValid: async () => false, login: async (email: string, ro?: boolean) => (termLogins.push({ email, ro: !!ro }), "session_token=x"), reconcile: async () => [] },
    identify: createAuth({ mode: "dev", devEmail: "tester@example.com", audience: "", production: false, settings: () => config.get().settings, secret: () => undefined, sessionKey: Buffer.alloc(32), log: () => {} }),
    authMode: "dev",
    adminToken: TOKEN,
    hooksListenerUrl: `http://127.0.0.1:${port}`,
    defaultHooksUrl: "defaultHooksUrl" in opts ? opts.defaultHooksUrl! : "https://hooks.example.run.app",
    secrets: secretStore.resolve,
    secretStore,
    allowedEmails: null,
    ensureSessions: async () => [],
    reloadSchedules: () => {},
    status: () => ({ workspace: null }),
    workspace: { sync: async () => {}, state: {} },
    deployKey: { publicKey: () => "ssh-ed25519 AAAATEST workbench", ensure: async () => {}, exists: () => true } as any,
  });
  return { dir, configPath, skillsDir, config, db, engine, pub, loc, layout, launcher, secretStore, zj };
}

type Ctx = Awaited<ReturnType<typeof build>>;
let c: Ctx;
beforeEach(async () => {
  c = await build();
});
afterAll(() => hooksServer?.close());

const json = (r: { body: string }) => JSON.parse(r.body);

describe("workflows", () => {
  it("creates a workflow with a starter skill and a rule in one step", async () => {
    const r = await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "email-jeff", group: { title: "Email Jeff", autonomy: "ask-first", actions: [{ id: "send", label: "Send" }] }, skill: true, rule: { on: "demo.email", prompt: "/email-jeff {{payload.text}}" } } });
    expect(r.statusCode).toBe(200);
    const w = json(r);
    expect(w.group).toMatchObject({ title: "Email Jeff", skill: "email-jeff" });
    expect(w.rules.map((x: any) => x.id)).toEqual(["email-jeff"]);
    expect(w.skill).toMatchObject({ name: "email-jeff", exists: true });
    expect(readFileSync(join(c.skillsDir, "email-jeff/SKILL.md"), "utf8")).toMatch(/^---\nname: email-jeff\n/);
    const list = json(await c.pub.inject({ url: "/api/workflows" }));
    expect(list.find((x: any) => x.id === "email-jeff")).toMatchObject({ rules: 1, actions: 1, skillExists: true });
  });

  it("rejects bad ids, duplicates and invalid settings without touching the file", async () => {
    const before = readFileSync(c.configPath, "utf8");
    expect((await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "Bad Id", group: { title: "x" } } })).statusCode).toBe(422);
    expect((await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "jira", group: { title: "x" } } })).statusCode).toBe(409);
    const bad = await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "ok-id", group: { title: "x", autonomy: "yolo" }, skill: true } });
    expect(bad.statusCode).toBe(422);
    expect(json(bad).errors.join("\n")).toMatch(/^group\.autonomy:/m);
    expect(readFileSync(c.configPath, "utf8")).toBe(before);
    expect(existsSync(join(c.skillsDir, "ok-id"))).toBe(false);
  });

  it("refuses rules with an empty event type or prompt before writing anything", async () => {
    const bad = await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "empty-rule", group: { title: "x" }, skill: true, rule: { on: "", prompt: "" } } });
    expect(bad.statusCode).toBe(422);
    expect(json(bad).errors.join("\n")).toMatch(/^rule\.on:/m);
    expect(existsSync(join(c.skillsDir, "empty-rule"))).toBe(false);
  });

  it("rolls back the starter skill if the whole-file config write fails", async () => {
    const real = c.config.update.bind(c.config);
    c.config.update = () => ({ ok: false, errors: ["(root): simulated failure"] });
    const bad = await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "rolls-back", group: { title: "x" }, skill: true } });
    c.config.update = real;
    expect(bad.statusCode).toBe(422);
    expect(existsSync(join(c.skillsDir, "rolls-back"))).toBe(false);
  });

  it("refuses to delete a workflow while rules start it, then deletes it and its skill", async () => {
    await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "temp-wf", group: { title: "Temp" }, skill: true, rule: { on: "x.y", prompt: "/temp-wf" } } });
    const refused = await c.pub.inject({ method: "DELETE", url: "/api/workflows/temp-wf?skill=1" });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error).toMatch(/temp-wf/);
    expect((await c.pub.inject({ method: "PUT", url: "/api/workflows/temp-wf/rules", payload: { rules: [] } })).statusCode).toBe(200);
    const ok = await c.pub.inject({ method: "DELETE", url: "/api/workflows/temp-wf?skill=1" });
    expect(json(ok)).toEqual({ deleted: "temp-wf", skillDeleted: true, closedRequests: 0 });
    expect(c.config.get().groups["temp-wf"]).toBeUndefined();
    expect(existsSync(join(c.skillsDir, "temp-wf"))).toBe(false);
  });

  it("closes a deleted workflow's open requests, since nothing can answer them", async () => {
    await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "short-lived", group: { title: "Short" } } });
    const req = json(await c.loc.inject({ method: "POST", url: "/requests", payload: { group: "short-lived", title: "Orphan soon", mode: "deferred" } }));
    const r = json(await c.pub.inject({ method: "DELETE", url: "/api/workflows/short-lived" }));
    expect(r.closedRequests).toBe(1);
    expect(c.engine.getRequest(req.id)!.status).toBe("closed");
  });

  it("replaces only this workflow's rules and reports errors by rule index", async () => {
    const bad = await c.pub.inject({ method: "PUT", url: "/api/workflows/house/rules", payload: { rules: [{ id: "a", on: "x", prompt: "p" }, { id: "b", prompt: "p" }] } });
    expect(bad.statusCode).toBe(422);
    expect(json(bad).errors.join("\n")).toMatch(/^rules\.1\.on:/m);
    const clash = await c.pub.inject({ method: "PUT", url: "/api/workflows/jira/rules", payload: { rules: [{ id: "merged", on: "x", prompt: "p" }] } });
    expect(clash.statusCode).toBe(422);
    const ok = await c.pub.inject({ method: "PUT", url: "/api/workflows/jira/rules", payload: { rules: [{ id: "jira-1", on: "jira.issue.created", prompt: "/jira {{payload.key}}" }] } });
    expect(ok.statusCode).toBe(200);
    const rules = c.config.get().rules;
    expect(rules.filter((r) => r.group === "house").map((r) => r.id)).toEqual(["merged", "only-shop", "any-deploy"]);
    expect(rules.find((r) => r.id === "jira-1")).toMatchObject({ group: "jira" });
  });

  it("aggregates the sources that feed a workflow's rules", async () => {
    const w = json(await c.pub.inject({ url: "/api/workflows/house" }));
    expect(w.sources.map((s: any) => s.id).sort()).toEqual(["deploy", "github"]);
    expect(w.sources.find((s: any) => s.id === "github").rules).toEqual(["merged", "only-shop"]);
  });
});

describe("invalid config writes", () => {
  it("validates the whole file: a rule pointing at a missing group is refused and nothing is written", async () => {
    const before = readFileSync(c.configPath, "utf8");
    const r = await c.pub.inject({ method: "PUT", url: "/api/config/rules", payload: { value: [{ id: "x", on: "a", prompt: "p", group: "nope" }] } });
    expect(r.statusCode).toBe(422);
    expect(json(r).errors.join("\n")).toMatch(/unknown group nope/);
    expect(readFileSync(c.configPath, "utf8")).toBe(before);
  });
  it("refuses a source without a verifier", async () => {
    const r = await c.pub.inject({ method: "PUT", url: "/api/sources/open", payload: { source: { path: "/hooks/open", adapter: "github" } } });
    expect(r.statusCode).toBe(422);
    expect(c.config.get().sources.open).toBeUndefined();
  });
});

describe("skills", () => {
  const good = (name: string) => `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`;
  it.each(["..", "../escape", "..%2Fescape", "a/b", "UPPER", ".hidden", "-lead", "x".repeat(70)])("rejects the name %j", async (name) => {
    const r = await c.pub.inject({ method: "PUT", url: `/api/skills/${encodeURIComponent(name)}`, payload: { content: good(name) } });
    expect([400, 404, 422]).toContain(r.statusCode);
    expect(existsSync(join(c.dir, "escape"))).toBe(false);
  });
  it("writes only inside the skills folder and validates frontmatter", async () => {
    expect((await c.pub.inject({ method: "PUT", url: "/api/skills/ok", payload: { content: good("ok") } })).statusCode).toBe(200);
    expect(readFileSync(join(c.skillsDir, "ok/SKILL.md"), "utf8")).toBe(good("ok"));
    const mismatch = await c.pub.inject({ method: "PUT", url: "/api/skills/ok", payload: { content: good("other") } });
    expect(mismatch.statusCode).toBe(422);
    expect(json(mismatch).error).toMatch(/must match/);
    expect((await c.pub.inject({ method: "PUT", url: "/api/skills/ok", payload: { content: "# no frontmatter" } })).statusCode).toBe(422);
    expect(json(await c.pub.inject({ url: "/api/skills" })).map((s: any) => s.name)).toEqual(["ok"]);
  });
  it("refuses a skill folder that is a symlink out of the skills folder", async () => {
    const outside = join(c.dir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(c.skillsDir, "sneaky"));
    const r = await c.pub.inject({ method: "PUT", url: "/api/skills/sneaky", payload: { content: good("sneaky") } });
    expect(r.statusCode).toBe(422);
    expect(existsSync(join(outside, "SKILL.md"))).toBe(false);
  });
  it("will not delete a skill a workflow uses", async () => {
    await c.pub.inject({ method: "PUT", url: "/api/skills/jira", payload: { content: good("jira") } });
    expect((await c.pub.inject({ method: "DELETE", url: "/api/skills/jira" })).statusCode).toBe(409);
  });
});

describe("runs search", () => {
  it("filters, pages and totals cost across the filtered set", async () => {
    for (let i = 0; i < 5; i++) c.engine.startRun({ group: i < 3 ? "house" : "jira", prompt: `task ${i}`, title: `Task ${i}` });
    c.db.prepare("update runs set cost_usd = 0.5").run();
    const all = json(await c.pub.inject({ url: "/api/runs/search?size=2" }));
    expect(all).toMatchObject({ total: 5, cost: 2.5, pages: 3, page: 1 });
    expect(all.rows).toHaveLength(2);
    const house = json(await c.pub.inject({ url: "/api/runs/search?group=house" }));
    expect(house).toMatchObject({ total: 3, cost: 1.5 });
    expect(json(await c.pub.inject({ url: "/api/runs/search?q=Task%204" })).total).toBe(1);
    expect(json(await c.pub.inject({ url: "/api/runs/search?from=2999-01-01" })).total).toBe(0);
  });
});

describe("sources", () => {
  it("lists full URLs, what they feed and the next schedule time", async () => {
    const s = json(await c.pub.inject({ url: "/api/sources" }));
    const gh = s.find((x: any) => x.id === "github");
    expect(gh).toMatchObject({ kind: "webhook", url: "https://hooks.example.run.app/hooks/github", emits: { prefix: "github." } });
    expect(gh.feeds.map((f: any) => f.id).sort()).toEqual(["merged", "only-shop"]);
    const nightly = s.find((x: any) => x.id === "nightly");
    expect(nightly.kind).toBe("schedule");
    expect(Date.parse(nightly.nextRun)).toBeGreaterThan(Date.now());
  });
  it("test-send signs the delivery exactly as the real verifier expects and marks it as a test", async () => {
    const r = json(await c.pub.inject({ method: "POST", url: "/api/sources/github/test", payload: {} }));
    expect(r.status).toBe(202);
    expect(lastHook!.url).toBe("/hooks/github");
    expect(lastHook!.headers["x-wb-test"]).toBe("1");
    expect(lastHook!.headers["x-github-event"]).toBe("pull_request");
    const ok = verify(c.config.get().sources.github!, { headers: lastHook!.headers, rawBody: Buffer.from(lastHook!.body), body: null }, (n) => (n === "GH_SECRET" ? "s3cret" : undefined));
    expect(ok).toBeNull();
    expect(lastHook!.headers["x-hub-signature-256"]).toBe("sha256=" + createHmac("sha256", "s3cret").update(lastHook!.body).digest("hex"));
    await c.pub.inject({ method: "POST", url: "/api/sources/deploy/test", payload: { triggerRules: true } });
    expect(lastHook!.headers["x-wb-test"]).toBeUndefined();
    expect(lastHook!.headers["x-hook-secret"]).toBe("d3ploy");
    expect(JSON.parse(lastHook!.body)).toEqual({ environment: "sample-env", commit: "sample-sha" });
  });
  it("test-sends every verifier kind the way the real sender would, and never shows a URL token", async () => {
    await c.secretStore.create("JT_SECRET", "tok-xyz");
    const put = (id: string, source: unknown) => c.pub.inject({ method: "PUT", url: `/api/sources/${id}`, payload: { source } });
    expect((await put("jt", { path: "/hooks/jt", verify: { kind: "url-token", secret: "JT_SECRET" }, adapter: "jira" })).statusCode).toBe(200);
    expect((await put("ci", { kind: "generic", path: "/hooks/ci", verify: { kind: "header", header: "X-Token", secret: "JT_SECRET" } })).statusCode).toBe(200);
    expect((await put("open", { path: "/hooks/open", verify: { kind: "none" }, map: { type: "open.thing", payload: {} } })).statusCode).toBe(200);
    expect((await put("sha1", { path: "/hooks/sha1", verify: { kind: "hmac", secret: "JT_SECRET", header: "X-Sig", algorithm: "sha1", prefix: "sha1=" }, map: { type: "s.x", payload: {} } })).statusCode).toBe(200);

    await c.pub.inject({ method: "POST", url: "/api/sources/jt/test", payload: {} });
    expect(lastHook!.url).toBe("/hooks/jt/tok-xyz");
    await c.pub.inject({ method: "POST", url: "/api/sources/ci/test", payload: {} });
    expect(lastHook!.headers["x-token"]).toBe("tok-xyz");
    expect(JSON.parse(lastHook!.body)).toMatchObject({ type: "ci.test", payload: { test: true } });
    await c.pub.inject({ method: "POST", url: "/api/sources/open/test", payload: {} });
    expect(lastHook!.url).toBe("/hooks/open");
    await c.pub.inject({ method: "POST", url: "/api/sources/sha1/test", payload: {} });
    expect(lastHook!.headers["x-sig"]).toBe("sha1=" + createHmac("sha1", "tok-xyz").update(lastHook!.body).digest("hex"));

    const list = await c.pub.inject({ url: "/api/sources" });
    expect(list.body).not.toContain("tok-xyz");
    expect(json(list).find((s: any) => s.id === "jt")).toMatchObject({ url: "https://hooks.example.run.app/hooks/jt/<token>", kind: "webhook" });
    expect(json(list).find((s: any) => s.id === "ci")).toMatchObject({ kind: "generic", emits: { any: true } });
  });

  it("records deliveries, including rejected ones, and test events never run rules", async () => {
    await c.loc.inject({ method: "POST", url: "/deliveries", payload: { source: "github", path: "/hooks/github", status: "rejected", reason: "bad signature" } });
    await c.loc.inject({ method: "POST", url: "/deliveries", payload: { source: "github", path: "/hooks/github", status: "accepted", event_type: "github.push", test: true } });
    const d = json(await c.pub.inject({ url: "/api/sources/github/deliveries" }));
    expect(d.map((x: any) => x.status)).toEqual(["accepted", "rejected"]);
    const ev = json(await c.loc.inject({ method: "POST", url: "/events", payload: { source: "webhook:github", type: "github.pull_request.merged", payload: { number: 1 }, test: true } }));
    expect(ev.runs).toEqual([]);
  });
});

describe("admin tools API", () => {
  it("needs the admin token", async () => {
    expect((await c.loc.inject({ url: "/admin/workflows" })).statusCode).toBe(403);
    expect((await c.loc.inject({ url: "/admin/workflows", headers: { "x-wb-admin-token": "wrong" } })).statusCode).toBe(403);
    expect((await c.loc.inject({ url: "/admin/workflows", headers: { "x-wb-admin-token": TOKEN } })).statusCode).toBe(200);
  });
  it("creates workflows, rules and windows through the same validation", async () => {
    const h = { "x-wb-admin-token": TOKEN };
    const wf = await c.loc.inject({ method: "PUT", url: "/admin/workflows/agent-made", headers: h, payload: { group: { title: "Agent made" }, skill: true } });
    expect(wf.statusCode).toBe(200);
    const badRule = await c.loc.inject({ method: "PUT", url: "/admin/rules/r1", headers: h, payload: { on: "x", prompt: "p", group: "missing" } });
    expect(badRule.statusCode).toBe(422);
    expect((await c.loc.inject({ method: "PUT", url: "/admin/rules/r1", headers: h, payload: { on: "x.y", prompt: "/agent-made", group: "agent-made" } })).statusCode).toBe(200);
    const win = json(await c.loc.inject({ method: "POST", url: "/admin/windows", headers: h, payload: { canvasId: "work", type: "requests", title: "Agent made", props: { groups: ["agent-made"] } } }));
    expect(win).toMatchObject({ canvasId: "work", type: "requests", props: { groups: ["agent-made"] } });
    expect(win.x % 20).toBe(0);
    expect((await c.loc.inject({ method: "POST", url: "/admin/windows", headers: h, payload: { canvasId: "nope", type: "requests" } })).statusCode).toBe(400);
  });
});

describe("documents", () => {
  const h = { "x-wb-admin-token": TOKEN, "x-wb-actor": "Alice Smith <alice@example.com>" };
  it("reads markdown under the workspace and refuses other files and places", async () => {
    writeFileSync(join(c.dir, "plan.md"), "# Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    const r = await c.pub.inject({ url: `/api/docs?path=${encodeURIComponent(join(c.dir, "plan.md"))}` });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ content: expect.stringContaining("# Plan"), size: expect.any(Number) });
    expect((await c.pub.inject({ url: `/api/docs?path=${encodeURIComponent(join(c.dir, "config.json"))}` })).statusCode).toBe(400);
    expect((await c.pub.inject({ url: `/api/docs?path=${encodeURIComponent(join(c.dir, "missing.md"))}` })).statusCode).toBe(404);
    expect((await c.pub.inject({ url: "/api/docs?path=/etc/hosts.md" })).statusCode).toBe(404);
    // A link out of the allowed folders is followed and refused.
    symlinkSync("/etc/hosts", join(c.dir, "hosts.md"));
    expect((await c.pub.inject({ url: `/api/docs?path=${encodeURIComponent(join(c.dir, "hosts.md"))}` })).statusCode).toBe(403);
  });

  it("opens a Document window beside the terminal it was asked from, once per file", async () => {
    writeFileSync(join(c.dir, "estimate.md"), "# DK-38\n\n2 points");
    const term = c.layout.upsertWindow({ canvasId: "work", type: "terminal", props: { session: "t-alice" }, x: 40, y: 40, w: 760, h: 520 });
    const r = await c.loc.inject({ method: "POST", url: "/admin/docs/open", headers: h, payload: { path: join(c.dir, "estimate.md"), session: "t-alice" } });
    expect(r.statusCode).toBe(201);
    const w = json(r);
    expect(w).toMatchObject({ canvasId: "work", type: "doc", title: "Document · estimate.md", x: term.x + term.w + 20, y: term.y });
    expect(w.props.path).toMatch(/estimate\.md$/);
    const again = await c.loc.inject({ method: "POST", url: "/admin/docs/open", headers: h, payload: { path: join(c.dir, "estimate.md"), session: "t-alice" } });
    expect(again.statusCode).toBe(200);
    expect(json(again).id).toBe(w.id);
    expect(c.layout.windows("work").filter((x) => x.type === "doc")).toHaveLength(1);
    expect((await c.loc.inject({ method: "POST", url: "/admin/docs/open", headers: h, payload: { path: join(c.dir, "config.json") } })).statusCode).toBe(400);
  });
});

describe("settings and the public hooks URL", () => {
  it("builds webhook URLs from settings, falls back to the default, and shows the path alone when neither is set", async () => {
    const url = async (x: Ctx) => json(await x.pub.inject({ url: "/api/sources" })).find((s: any) => s.id === "github").url;
    expect(await url(c)).toBe("https://hooks.example.run.app/hooks/github");
    const r = await c.pub.inject({ method: "PUT", url: "/api/settings", payload: { value: { publicHooksUrl: "https://hooks.acme.dev" } } });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ hooksBase: "https://hooks.acme.dev", hooksBaseFrom: "settings" });
    expect(await url(c)).toBe("https://hooks.acme.dev/hooks/github");
    const bare = await build({ defaultHooksUrl: null });
    expect(await url(bare)).toBeNull();
    expect(json(await bare.pub.inject({ url: "/api/meta" }))).toMatchObject({ hooksBase: null, hooksBaseFrom: null });
  });

  it("validates settings with field paths and leaves the file alone", async () => {
    const before = readFileSync(c.configPath, "utf8");
    const r = await c.pub.inject({ method: "PUT", url: "/api/settings", payload: { value: { publicHooksUrl: "hooks.acme.dev/", timezone: "Mars/Olympus", limits: { maxTerminals: 0 }, workspaceRemote: "not a url" } } });
    expect(r.statusCode).toBe(422);
    const errs = json(r).errors.join("\n");
    expect(errs).toMatch(/^settings\.publicHooksUrl:/m);
    expect(errs).toMatch(/^settings\.timezone: not an IANA time zone/m);
    expect(errs).toMatch(/^settings\.limits\.maxTerminals:/m);
    expect(errs).toMatch(/^settings\.workspaceRemote:/m);
    expect(readFileSync(c.configPath, "utf8")).toBe(before);
  });

  it("keeps the box id when a save leaves it out or tries to change it", async () => {
    c.config.update((raw: any) => ({ ...raw, settings: { box: { id: "box_keepme", name: "A" } } }), { message: "t" });
    await c.pub.inject({ method: "PUT", url: "/api/settings", payload: { value: { box: { id: "box_other", name: "Renamed" }, defaultModel: "haiku" } } });
    expect(c.config.get().settings.box).toEqual({ id: "box_keepme", name: "Renamed" });
    expect(c.config.get().settings.defaultModel).toBe("haiku");
  });
});

describe("secrets API", () => {
  it("shows a generated value once, never again, and records who did it", async () => {
    const r = await c.pub.inject({ method: "POST", url: "/api/secrets", payload: { name: "JIRA_HOOK_SECRET", generate: true } });
    expect(r.statusCode).toBe(201);
    const value = json(r).value as string;
    expect(value).toHaveLength(43);
    const list = await c.pub.inject({ url: "/api/secrets" });
    expect(list.body).not.toContain(value);
    expect(json(list).secrets.find((s: any) => s.name === "JIRA_HOOK_SECRET")).toMatchObject({ from: "store", usedBy: [] });
    const typed = await c.pub.inject({ method: "POST", url: "/api/secrets", payload: { name: "TYPED_ONE", value: "typed-value" } });
    expect(typed.body).not.toContain("typed-value");
    const act = json(await c.pub.inject({ url: "/api/events?type=secret.created" }));
    const rows = (act.events ?? act).filter((e: any) => e.type === "secret.created");
    expect(rows.map((e: any) => e.summary).join("\n")).not.toContain(value);
    expect(rows.length).toBe(2);
  });

  it("rotates, refuses to delete while referenced, and the verifier uses the store before the environment", async () => {
    // GH_SECRET is in the environment (s3cret); storing it makes the store win.
    await c.pub.inject({ method: "POST", url: "/api/secrets", payload: { name: "GH_SECRET", value: "from-store" } });
    expect(c.secretStore.resolve("GH_SECRET")).toBe("from-store");
    const del = await c.pub.inject({ method: "DELETE", url: "/api/secrets/GH_SECRET" });
    expect(del.statusCode).toBe(409);
    expect(json(del).usedBy[0].where).toBe("source github");
    const rot = await c.pub.inject({ method: "POST", url: "/api/secrets/GH_SECRET/rotate", payload: { generate: true } });
    expect(rot.statusCode).toBe(200);
    expect(c.secretStore.resolve("GH_SECRET")).toBe(json(rot).value);
    expect((await c.pub.inject({ method: "POST", url: "/api/secrets/NOPE/rotate", payload: { value: "x" } })).statusCode).toBe(404);
  });

  it("never writes a secret value into config.json", async () => {
    const r = await c.pub.inject({ method: "POST", url: "/api/secrets", payload: { name: "NEW_HOOK", generate: true } });
    const v = json(r).value;
    await c.pub.inject({ method: "PUT", url: "/api/sources/newhook", payload: { source: { path: "/hooks/newhook", verify: { kind: "header", header: "X-Hook-Secret", secret: "NEW_HOOK" }, map: { type: "x.y", payload: {} } } } });
    expect(readFileSync(c.configPath, "utf8")).not.toContain(v);
  });
});

describe("terminals people open", () => {
  it("opens a terminal in the workspace with WB_ACTOR set and lists it under Yours, and under Others for someone else", async () => {
    const r = await c.pub.inject({ method: "POST", url: "/api/terminals", payload: { title: "Deploy check", command: "git status" } });
    expect(r.statusCode).toBe(201);
    const t = json(r);
    expect(t).toMatchObject({ title: "Deploy check", cwd: "workspace", command: "git status", created_by: "tester@example.com" });
    expect(t.name).toMatch(/^t-deploy-check-[0-9a-f]{4}$/);
    const layout = c.zj.sessions.get(t.name)!.layout;
    expect(layout).toContain(`cwd ${JSON.stringify(c.dir)}`);
    expect(layout).toContain("export WB_ACTOR=");
    expect(layout).toContain("tester@example.com");
    expect(layout).toContain("git status");
    const mine = json(await c.pub.inject({ url: "/api/terminals" }));
    expect(mine.yours.map((x: any) => x.name)).toEqual([t.name]);
    expect(mine.yours[0]).toMatchObject({ createdBy: "tester@example.com" });
    const theirs = json(await c.pub.inject({ url: "/api/terminals", headers: { "x-wb-as": "bob" } }));
    expect(theirs.yours).toEqual([]);
    expect(theirs.others.map((x: any) => x.name)).toEqual([t.name]);
  });

  it("checks the starting folder, renames, closes, and records both in Activity", async () => {
    expect((await c.pub.inject({ method: "POST", url: "/api/terminals", payload: { title: "x", cwd: "repo:nope" } })).statusCode).toBe(422);
    expect((await c.pub.inject({ method: "POST", url: "/api/terminals", payload: { title: "x", cwd: "/definitely/not/here" } })).statusCode).toBe(422);
    const t = json(await c.pub.inject({ method: "POST", url: "/api/terminals", payload: { title: "Scratch", cwd: tmpdir() } }));
    expect(c.zj.sessions.get(t.name)!.layout).toContain(`cwd ${JSON.stringify(tmpdir())}`);
    expect(json(await c.pub.inject({ method: "PATCH", url: `/api/terminals/${t.name}`, payload: { title: "Scratch pad" } })).title).toBe("Scratch pad");
    const win = c.layout.upsertWindow({ canvasId: "work", type: "terminal", props: { session: t.name } } as any);
    expect((await c.pub.inject({ method: "DELETE", url: `/api/terminals/${t.name}` })).statusCode).toBe(200);
    expect(c.zj.sessions.has(t.name)).toBe(false);
    // A window left on an ended terminal would make Zellij recreate it, so it moves to the shell.
    expect(c.layout.windows().find((w) => w.id === win.id)!.props.session).toBe("shell");
    expect((await c.pub.inject({ method: "DELETE", url: `/api/terminals/${t.name}` })).statusCode).toBe(404);
    const ev = json(await c.pub.inject({ url: "/api/events" }));
    const types = (ev.events ?? ev).map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["terminal.opened", "terminal.closed"]));
  });

  it("enforces the box's terminal limit", async () => {
    c.config.update((raw: any) => ({ ...raw, settings: { ...(raw.settings ?? {}), limits: { maxTerminals: 2 } } }), { message: "t" });
    for (const n of ["a", "b"]) expect((await c.pub.inject({ method: "POST", url: "/api/terminals", payload: { title: n } })).statusCode).toBe(201);
    const r = await c.pub.inject({ method: "POST", url: "/api/terminals", payload: { title: "c" } });
    expect(r.statusCode).toBe(429);
    expect(json(r).error).toMatch(/allows 2 open terminals/);
  });

  it("lets the admin tools open one on behalf of the person in WB_ACTOR", async () => {
    const h = { "x-wb-admin-token": TOKEN, "x-wb-actor": "Alice Smith <alice@example.com>" };
    const r = await c.loc.inject({ method: "POST", url: "/admin/terminals", headers: h, payload: { title: "For Alice" } });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ created_by: "alice@example.com", created_by_name: "Alice Smith" });
  });
});

describe("import MCP servers from Claude Code", () => {
  const withClaudeConfig = async (cfg: unknown, fn: () => Promise<void>) => {
    const home = mkdtempSync(join(tmpdir(), "wb-claude-"));
    writeFileSync(join(home, ".claude.json"), JSON.stringify(cfg));
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      await fn();
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  };
  const claudeCfg = {
    mcpServers: {
      atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" },
      linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer lin_api_abcdefghijklmnop" } },
    },
    projects: {
      "/some/project": { mcpServers: { db: { type: "stdio", command: "npx", args: ["-y", "pg-mcp"], env: { PG_PASSWORD: "hunter22", PG_HOST: "localhost", HOME_DIR: "${HOME}" } } } },
      "/empty": { mcpServers: {} },
    },
  };

  it("lists every scope, without the workbench's own server, and masks secret-looking values", async () => {
    writeFileSync(join(c.dir, ".mcp.json"), JSON.stringify({ mcpServers: { workbench: { command: "node" }, docs: { type: "http", url: "http://127.0.0.1:9/mcp" } } }));
    await withClaudeConfig(claudeCfg, async () => {
      const r = await c.pub.inject({ url: "/api/mcp/claude-code" });
      const list = json(r).servers;
      expect(list.map((s: any) => `${s.scope}:${s.name}`).sort()).toEqual(["local:db", "project:docs", "user:atlassian", "user:linear"]);
      expect(r.body).not.toContain("lin_api_abcdefghijklmnop");
      expect(r.body).not.toContain("hunter22");
      const db = list.find((s: any) => s.name === "db");
      expect(db).toMatchObject({ where: "/some/project", secrets: ["env.PG_PASSWORD"], masked: { env: { PG_PASSWORD: "••••", PG_HOST: "localhost", HOME_DIR: "${HOME}" } } });
    });
  });

  it("copies chosen servers into the workflow and moves inline secrets into the store", async () => {
    await withClaudeConfig(claudeCfg, async () => {
      const list = json(await c.pub.inject({ url: "/api/mcp/claude-code" })).servers;
      const keys = list.filter((s: any) => ["linear", "db", "atlassian"].includes(s.name)).map((s: any) => s.key);
      const r = await c.pub.inject({ method: "POST", url: "/api/workflows/jira/mcp/import", payload: { keys } });
      expect(r.statusCode).toBe(200);
      expect(json(r)).toMatchObject({ imported: expect.arrayContaining(["linear", "db", "atlassian"]), secretsCreated: expect.arrayContaining(["LINEAR_TOKEN", "DB_PG_PASSWORD"]) });
      const g = c.config.get().groups.jira!.mcpServers as any;
      expect(g.linear.headers.Authorization).toBe("Bearer ${secret:LINEAR_TOKEN}");
      expect(g.db.env).toEqual({ PG_PASSWORD: "${secret:DB_PG_PASSWORD}", PG_HOST: "localhost", HOME_DIR: "${HOME}" });
      expect(g.atlassian).toEqual({ type: "http", url: "https://mcp.atlassian.com/v1/mcp" });
      const file = readFileSync(c.configPath, "utf8");
      expect(file).not.toContain("lin_api_abcdefghijklmnop");
      expect(file).not.toContain("hunter22");
      expect(c.secretStore.resolve("LINEAR_TOKEN")).toBe("lin_api_abcdefghijklmnop");
      // Importing again reuses the same secret instead of making LINEAR_TOKEN_2.
      const again = json(await c.pub.inject({ method: "POST", url: "/api/workflows/jira/mcp/import", payload: { keys: [list.find((s: any) => s.name === "linear").key] } }));
      expect(again).toMatchObject({ secretsCreated: [], secretsReused: ["LINEAR_TOKEN"] });
    });
  });
});

describe("roles", () => {
  const people = () =>
    c.config.update((raw: any) => ({ ...raw, settings: { ...(raw.settings ?? {}), access: { users: [{ email: "boss@example.com", role: "admin" }, { email: "carol@example.com", role: "member" }, { email: "vic@example.com", role: "viewer" }] } } }), { message: "people" });
  const as = (who: string) => ({ "x-wb-as": who });

  it("needs admin for anything that changes how the box works, member for running things, nothing to read", () => {
    const admin = [["PUT", "/api/settings"], ["PUT", "/api/config/rules"], ["POST", "/api/workflows"], ["PUT", "/api/workflows/x"], ["DELETE", "/api/workflows/x"], ["PUT", "/api/workflows/x/rules"], ["POST", "/api/workflows/x/mcp/import"],
      ["PUT", "/api/skills/x"], ["DELETE", "/api/skills/x"], ["PUT", "/api/sources/x"], ["DELETE", "/api/sources/x"], ["POST", "/api/sources/x/test"], ["POST", "/api/secrets"], ["POST", "/api/secrets/X/rotate"], ["DELETE", "/api/secrets/X"],
      ["PUT", "/api/repos/x"], ["DELETE", "/api/repos/x"], ["POST", "/api/repos/x/fetch"], ["POST", "/api/keys/deploy"], ["POST", "/api/workspace/sync"], ["POST", "/api/services/app/restart"], ["POST", "/api/runs/cleanup"]];
    const member = [["POST", "/api/runs"], ["POST", "/api/runs/4/steer"], ["POST", "/api/runs/4/stop"], ["POST", "/api/runs/4/resume"], ["POST", "/api/requests/9/answer"], ["POST", "/api/terminals"], ["PATCH", "/api/terminals/t-a-1234"], ["DELETE", "/api/terminals/t-a-1234"], ["POST", "/api/sessions/ensure"]];
    for (const [m, p] of admin) expect(requiredRole(m!, p!), `${m} ${p}`).toBe("admin");
    for (const [m, p] of member) expect(requiredRole(m!, p!), `${m} ${p}`).toBe("member");
    expect(requiredRole("GET", "/api/settings")).toBe("viewer");
    expect(requiredRole("POST", "/api/term-login")).toBe("viewer");
  });

  it("viewers read everything and change nothing; terminals are watch-only for them", async () => {
    people();
    expect((await c.pub.inject({ url: "/api/me", headers: as("vic@example.com") })).json()).toMatchObject({ role: "viewer" });
    for (const url of ["/api/settings", "/api/runs", "/api/workflows", "/api/secrets", "/api/sources"]) expect((await c.pub.inject({ url, headers: as("vic@example.com") })).statusCode, url).toBe(200);
    const deny = [
      { method: "POST" as const, url: "/api/runs", payload: { group: "house", prompt: "x" } },
      { method: "POST" as const, url: "/api/terminals", payload: { title: "x" } },
      { method: "PUT" as const, url: "/api/settings", payload: { value: {} } },
      { method: "POST" as const, url: "/api/secrets", payload: { name: "X", generate: true } },
    ];
    for (const d of deny) expect((await c.pub.inject({ ...d, headers: as("vic@example.com") })).statusCode, d.url).toBe(403);
    expect(c.launcher.started).toHaveLength(0);
    await c.pub.inject({ method: "POST", url: "/api/term-login", headers: as("vic@example.com") });
    await c.pub.inject({ method: "POST", url: "/api/term-login", headers: as("carol@example.com") });
    expect(termLogins.slice(-2)).toEqual([{ email: "vic@example.com", ro: true }, { email: "carol@example.com", ro: false }]);
  });

  it("members run things but cannot change settings, secrets or workflows, nor end someone else's terminal", async () => {
    people();
    const m = as("carol@example.com");
    expect((await c.pub.inject({ method: "POST", url: "/api/runs", headers: m, payload: { group: "house", prompt: "go" } })).statusCode).toBe(200);
    for (const d of [{ method: "PUT", url: "/api/settings", payload: { value: {} } }, { method: "POST", url: "/api/secrets", payload: { name: "X", generate: true } }, { method: "POST", url: "/api/workflows", payload: { id: "nope", group: { title: "x" } } }] as const)
      expect((await c.pub.inject({ ...d, headers: m })).statusCode, d.url).toBe(403);
    const t = (await c.pub.inject({ method: "POST", url: "/api/terminals", headers: as("boss@example.com"), payload: { title: "Boss's" } })).json();
    expect((await c.pub.inject({ method: "DELETE", url: `/api/terminals/${t.name}`, headers: m })).statusCode).toBe(403);
    expect((await c.pub.inject({ method: "DELETE", url: `/api/terminals/${t.name}`, headers: as("boss@example.com") })).statusCode).toBe(200);
  });

  it("the first person to finish Setup can claim admin, once", async () => {
    c.config.update((raw: any) => ({ ...raw, settings: { ...(raw.settings ?? {}), access: { users: [] } } }), { message: "empty" });
    expect((await c.pub.inject({ url: "/api/setup/admin" })).json()).toMatchObject({ hasAdmin: false });
    expect((await c.pub.inject({ method: "POST", url: "/api/setup/claim-admin", headers: as("first@example.com") })).statusCode).toBe(200);
    expect(c.config.get().settings.access.users).toEqual([{ email: "first@example.com", role: "admin" }]);
    expect((await c.pub.inject({ method: "POST", url: "/api/setup/claim-admin", headers: as("second@example.com") })).statusCode).toBe(409);
  });
});

describe("setup endpoint", () => {
  it("reports each item from the box's real state and turns items green as they get done", async () => {
    const first = (await c.pub.inject({ url: "/api/setup" })).json();
    const st = (id: string, v = first) => v.items.find((i: any) => i.id === id);
    expect(st("delivery").done).toBe(false);
    expect(st("workflow").done).toBe(false);
    expect(st("secrets").done).toBe(false);
    expect(st("secrets").detail).toContain("PROXY_SECRET");
    await c.pub.inject({ method: "POST", url: "/api/secrets", payload: { name: "PROXY_SECRET", generate: true } });
    await c.pub.inject({ method: "POST", url: "/api/sources/github/test", payload: {} });
    await c.loc.inject({ method: "POST", url: "/deliveries", payload: { source: "github", path: "/hooks/github", status: "accepted", event_type: "github.ping" } });
    await c.pub.inject({ method: "POST", url: "/api/workflows", payload: { id: "first-one", group: { title: "First" }, skill: true } });
    const after = (await c.pub.inject({ url: "/api/setup" })).json();
    expect(st("delivery", after).done).toBe(true);
    expect(st("workflow", after).done).toBe(true);
    expect(st("secrets", after).done).toBe(true);
  });
});
