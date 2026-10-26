// Upgrade and rollback against earlier releases' own code: every tarball in dist/ from this build's
// MIN_UPGRADE_FROM up to (not including) this version, each installed offline and run as a real server
// on throwaway folders and ports. CI downloads those tarballs from the GitHub releases first. Nothing reaches the network, and no
// agent can start (Zellij and Claude Code are stubbed with `false`).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareVersions, MIN_UPGRADE_FROM } from "../src/release.ts";

const ROOT = join(import.meta.dirname, "../../..");
const CURRENT = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
const TOKEN = "u".repeat(32);
const PORT = 28200;

interface Previous {
  version: string;
  path: string;
  /** From the tarball's release.json (0.4.0 on); 0.3.0 has none, so no capabilities. */
  capabilities: string[];
}

/** Every release in dist/ that may upgrade straight to this one, oldest first. */
function previousTarballs(): Previous[] {
  const dist = join(ROOT, "dist");
  if (!existsSync(dist)) return [];
  return readdirSync(dist)
    .map((n) => n.match(/^workbench-(\d+\.\d+\.\d+)\.tar\.gz$/))
    .filter((m): m is RegExpMatchArray => !!m && compareVersions(m[1]!, CURRENT) < 0 && compareVersions(m[1]!, MIN_UPGRADE_FROM) >= 0)
    .sort((a, b) => compareVersions(a[1]!, b[1]!))
    .map((m) => {
      const manifest = join(dist, `workbench-${m[1]}.release.json`);
      const capabilities = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")).capabilities as string[]) : [];
      return { version: m[1]!, path: join(dist, m[0]), capabilities };
    });
}
const previous = previousTarballs();

/** Unpacks and installs a previous release once per checkout; pnpm's store makes it offline and quick. */
function installPrevious(prev: Previous): string {
  // Not the system temp folder (macOS prunes old files there, leaving a broken install behind) and not
  // under node_modules (Node will not strip types there): the user's cache folder.
  const dir = join(homedir(), ".cache", "workbench", `upgrade-${prev.version}`);
  const product = join(dir, `workbench-${prev.version}`);
  if (!existsSync(join(product, "node_modules"))) {
    mkdirSync(dir, { recursive: true });
    execFileSync("tar", ["-xzf", prev.path, "-C", dir]);
    execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile"], { cwd: product, stdio: "ignore" });
  }
  return product;
}

interface Box {
  root: string;
  data: string;
  workspace: string;
}
function newBox(): Box {
  const root = mkdtempSync(join(tmpdir(), "wb-upg-"));
  return { root, data: join(root, "internal"), workspace: join(root, "workspace") };
}
function copyBox(b: Box): Box {
  const c = newBox();
  cpSync(b.root, c.root, { recursive: true, verbatimSymlinks: true });
  return c;
}

interface Running {
  proc: ChildProcess;
  log: () => string;
  stop: () => Promise<void>;
  exited: Promise<number | null>;
}

const running = new Set<Running>();

/** Starts one product's app server on a box. Resolves once its management API answers, or it exits. */
async function start(product: string, box: Box, o: { version?: string } = {}): Promise<Running & { code: number | null; up: boolean }> {
  const home = join(box.root, "home");
  mkdirSync(home, { recursive: true });
  // A clean environment: nothing from the shell running the tests (it may be the live box's).
  const env: Record<string, string> = {
    PATH: process.env.PATH!,
    HOME: home,
    AUTH_MODE: "dev",
    WB_DATA_DIR: box.data,
    WB_WORKSPACE_DIR: box.workspace,
    WB_TOOLS_DIR: join(box.root, "tools"),
    WB_PUBLIC_PORT: String(PORT),
    WB_LOCAL_API_PORT: String(PORT + 1),
    WB_MANAGEMENT_PORT: String(PORT + 2),
    WB_MANAGEMENT_TOKEN: TOKEN,
    WB_YJS_PORT: String(PORT + 3),
    WB_HOOKS_PORT: String(PORT + 4),
    WB_SUPERVISOR_PORT: String(PORT + 5),
    WB_ZELLIJ_WEB_PORT: String(PORT + 6),
    WB_ZELLIJ_BIN: "/usr/bin/false",
    WB_CLAUDE_BIN: "/usr/bin/false",
    ZELLIJ_SOCKET_DIR: join(box.root, "zj"),
    WB_ZELLIJ_TOKENS_DB: join(box.root, "zellij-tokens.db"),
    ...(o.version ? { WB_VERSION: o.version } : {}),
  };
  const proc = spawn(process.execPath, ["packages/app/src/server.ts"], { cwd: product, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout!.on("data", (d) => (out += d));
  proc.stderr!.on("data", (d) => (out += d));
  let code: number | null | undefined;
  const exited = new Promise<number | null>((r) => proc.on("exit", (c) => r((code = c))));
  const r: Running = {
    proc,
    log: () => out,
    exited,
    stop: async () => {
      if (code === undefined) {
        proc.kill("SIGTERM");
        await exited;
      }
      running.delete(r);
    },
  };
  running.add(r);
  for (let i = 0; i < 150 && code === undefined; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT + 2}/v1/info`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(500) });
      if (res.ok) return { ...r, code: null, up: true };
    } catch {}
    await new Promise((res) => setTimeout(res, 100));
  }
  if (code === undefined) await r.stop();
  return { ...r, code: code ?? null, up: false };
}

const mgmt = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT + 2}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return r.json();
};
const admin = async (box: Box, path: string, method = "GET", body?: unknown) => {
  const token = readFileSync(join(box.data, "admin.token"), "utf8").trim();
  const r = await fetch(`http://127.0.0.1:${PORT + 1}/admin${path}`, {
    method,
    headers: { "x-wb-admin-token": token, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const local = async (path: string) => (await fetch(`http://127.0.0.1:${PORT + 1}${path}`)).json();

/** Pretends a newer build migrated the data: a higher schema, and the floor it recorded. */
function forgeNewer(box: Box, schema: number, floor: number) {
  const db = new Database(join(box.data, "workbench.db"));
  db.pragma(`user_version = ${schema}`);
  db.exec("create table if not exists workbench_meta (key text primary key, value text not null)");
  db.prepare("insert into workbench_meta (key, value) values ('compat_floor', ?) on conflict(key) do update set value = excluded.value").run(String(floor));
  db.close();
}

/** What the box holds: checked the same way on every build. */
async function contents(box: Box) {
  const workflows = (await admin(box, "/workflows")) as { id: string }[];
  const secrets = (await admin(box, "/secrets")) as { name: string; set?: boolean; where?: string }[];
  const runs = (await local("/runs?pageSize=50")) as any;
  const runList = (Array.isArray(runs) ? runs : runs.runs) as { title: string }[];
  const config = JSON.parse(readFileSync(join(box.workspace, "config.json"), "utf8"));
  const secretFile = JSON.parse(readFileSync(join(box.data, "secrets.json"), "utf8"));
  return {
    workflow: workflows.some((w) => w.id === "upgrade-check"),
    secret: secrets.find((s) => s.name === "UPGRADE_SECRET") ?? null,
    secretStored: JSON.stringify(secretFile).includes("UPGRADE_SECRET"),
    runs: runList.map((r) => r.title).filter((t) => t.startsWith("Upgrade run")).sort(),
    boxName: config.settings.box.name,
  };
}

it.skipIf(previous.length > 0)(`no earlier release in dist/ (from ${MIN_UPGRADE_FROM}); upgrade tests skipped`, () => {});

describe.each(previous)(`upgrading from $version to ${CURRENT}`, (prev) => {
  let product: string;
  const box = newBox();
  let before: Awaited<ReturnType<typeof contents>>;

  beforeAll(async () => {
    product = installPrevious(prev);
    // The previous release creates the box and gets a workflow, a secret, settings, runs and a request.
    const old = await start(product, box, { version: prev.version });
    expect(old.up, old.log()).toBe(true);
    await admin(box, "/workflows/upgrade-check", "PUT", { group: { title: "Upgrade check", autonomy: "autonomous", actions: [{ id: "ok", label: "OK" }] } });
    await admin(box, "/secrets", "POST", { name: "UPGRADE_SECRET", value: "kept-across-upgrades" });
    const settings = JSON.parse(readFileSync(join(box.workspace, "config.json"), "utf8")).settings;
    await admin(box, "/settings", "PUT", { value: { ...settings, box: { ...settings.box, name: "Upgrade box" } } });
    await old.stop();
    // Runs and a request as they were left: written straight into the old build's database.
    const db = new Database(join(box.data, "workbench.db"));
    for (const [title, status] of [["Upgrade run done", "done"], ["Upgrade run failed", "failed"], ["Upgrade run waiting", "queued"]])
      db.prepare("insert into runs (group_id, title, prompt, session_id, status) values ('upgrade-check', ?, 'p', ?, ?)").run(title, `s-${status}`, status);
    db.prepare("insert into requests (group_id, title, actions, mode) values ('upgrade-check', 'Upgrade request', '[]', 'deferred')").run();
    db.close();
    const again = await start(product, box, { version: prev.version });
    before = await contents(box);
    await again.stop();
  }, 120_000);

  afterAll(async () => {
    for (const r of [...running]) await r.stop();
  });

  it("the current build starts on the previous release's data and everything survives", async () => {
    expect(before).toMatchObject({ workflow: true, secretStored: true, boxName: "Upgrade box", runs: ["Upgrade run done", "Upgrade run failed", "Upgrade run waiting"] });
    const cur = await start(ROOT, box);
    expect(cur.up, cur.log()).toBe(true);
    const info = await mgmt("/v1/info");
    expect(info).toMatchObject({ version: CURRENT, data: { newerThanBuild: false } });
    expect(await contents(box)).toEqual(before);
    const reqs = (await local("/requests")) as { title: string }[];
    expect(reqs.map((r) => r.title)).toContain("Upgrade request");
    // The new update steps work on upgraded data.
    expect(await mgmt("/v1/drain", { method: "POST", body: { timeoutSeconds: 0 } })).toMatchObject({ draining: true, ready: true });
    const backup = await mgmt("/v1/backup", { method: "POST" });
    expect(backup.contents).toEqual(["workbench.db", "workspace", "secrets.json"]);
    await cur.stop();
  }, 60_000);

  it("the previous release still runs on the upgraded data (rollback without a restore)", async () => {
    const old = await start(product, box, { version: prev.version });
    expect(old.up, old.log()).toBe(true);
    expect((await mgmt("/v1/info")).version).toBe(prev.version);
    expect(await contents(box)).toEqual(before);
    await old.stop();
  }, 60_000);

  it("both builds refuse cleanly (exit 3, a clear message) data whose floor they do not meet", async () => {
    const b = copyBox(box);
    forgeNewer(b, 99, 99);
    const old = await start(product, b, { version: prev.version });
    expect(old.up).toBe(false);
    expect(old.code).toBe(3);
    expect(old.log()).toMatch(/refusing to start: the database is schema 99/);
    const cur = await start(ROOT, b);
    expect(cur.code).toBe(3);
    expect(cur.log()).toMatch(/needs at least schema 99/);
  }, 60_000);

  it("the current build runs on newer data whose floor it meets; the previous one does too if it knows floors", async () => {
    const b = copyBox(box);
    const startedOnce = await start(ROOT, b);
    await startedOnce.stop();
    forgeNewer(b, 99, 1);
    const cur = await start(ROOT, b);
    expect(cur.up, cur.log()).toBe(true);
    expect((await mgmt("/v1/info")).data).toEqual({ schemaVersion: 99, compatFloor: 1, newerThanBuild: true });
    expect(await contents(b)).toEqual(before);
    await cur.stop();
    const old = await start(product, b, { version: prev.version });
    if (prev.capabilities.includes("compat-floor")) {
      expect(old.up, old.log()).toBe(true);
      await old.stop();
    } else expect(old.code).toBe(3);
  }, 60_000);

  it("put back after a failed breaking update, the current build restores its own backup and starts", async () => {
    const b = copyBox(box);
    const cur = await start(ROOT, b);
    const backup = await mgmt("/v1/backup", { method: "POST" });
    await mgmt("/v1/update/begin", { method: "POST", body: { to: { version: "99.0.0", schemaVersion: 99, compatFloor: 99 }, backup: backup.path, by: "upgrade test" } });
    await cur.stop();
    // 99.0.0 migrated the data and failed; the routine puts this build back.
    forgeNewer(b, 99, 99);
    const back = await start(ROOT, b);
    expect(back.up, back.log()).toBe(true);
    expect(back.log()).toMatch(/restored workbench.db from/);
    const rec = (await mgmt("/v1/update")).record;
    expect(rec.state).toBe("restored");
    expect((await mgmt("/v1/info")).data).toMatchObject({ newerThanBuild: false });
    expect(await contents(b)).toEqual(before);
    await back.stop();
  }, 60_000);
});
