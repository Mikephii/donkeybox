import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/engine/config.ts";
import { migrations, NewerSchemaError, openDb, SCHEMA_VERSION, type Migration } from "../src/engine/db.ts";
import { listBackups, Maintenance, noteBoot, readUpdateRecord, selfRestore } from "../src/lib/maintenance.ts";
import { releaseManifest } from "../src/release.ts";
import { setup, tick } from "./helpers.ts";

const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });

/** A box's folders on disk: internal folder with a real database, a config repo, a secrets file. */
function box(version = "1.0.0") {
  const root = mkdtempSync(join(tmpdir(), "wb-maint-"));
  const dataDir = join(root, "internal");
  const workspaceDir = join(root, "workspace");
  mkdirSync(dataDir);
  mkdirSync(workspaceDir);
  writeFileSync(join(workspaceDir, "config.json"), JSON.stringify({ settings: { box: { id: "box_1", name: "Acme" } } }, null, 2));
  mkdirSync(join(workspaceDir, "node_modules"));
  writeFileSync(join(workspaceDir, "node_modules", "big.js"), "x");
  git(workspaceDir, "init", "-q", "-b", "main");
  git(workspaceDir, "add", "-A");
  git(workspaceDir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  const secretsPath = join(dataDir, "secrets.json");
  writeFileSync(secretsPath, JSON.stringify({ GH: { value: "s1" } }), { mode: 0o600 });
  const dbPath = join(dataDir, "workbench.db");
  const db = openDb(dbPath);
  db.prepare("insert into runs (group_id, title, prompt, session_id, status) values ('g','before update','p','s1','done')").run();
  const m = new Maintenance({
    db, dataDir, workspaceDir, secretsPath, manifest: releaseManifest(version), box: () => "box_1",
    liveRuns: () => 0, queuedRuns: () => 0,
  });
  return { root, dataDir, workspaceDir, secretsPath, dbPath, db, m };
}

const configLoads = (p: string) => {
  try {
    return parseConfig(JSON.parse(readFileSync(p, "utf8"))).ok;
  } catch {
    return false;
  }
};

describe("drain", () => {
  it("keeps queued runs waiting while draining and starts them when the drain ends", async () => {
    const t = setup();
    const live = () => (t.db.prepare("select count(*) n from runs where status in ('starting','working','blocked')").get() as { n: number }).n;
    const m = new Maintenance({
      db: t.db, dataDir: t.dir, workspaceDir: t.dir, secretsPath: null, manifest: releaseManifest("1.0.0"), box: () => null,
      liveRuns: live, queuedRuns: () => 0, onChange: () => !m.draining && t.engine.launchQueued(),
    });
    (t.engine as any).limits = () => ({ maxConcurrentRuns: 9, blocked: m.blockedReason() });
    const a = t.engine.startRun({ group: "house", prompt: "a" });
    await tick();
    t.engine.setStatus(a.id, "working");
    expect(m.drain("ops@acme.dev", 600)).toMatchObject({ draining: true, liveRuns: 1, ready: false });
    const b = t.engine.startRun({ group: "house", prompt: "b" });
    await tick();
    expect(t.engine.getRun(b.id)!.status).toBe("queued");
    expect(t.engine.waitingReason()).toMatch(/ready for an update/);
    t.engine.setStatus(a.id, "done");
    await tick();
    // A slot freed, but the drain still holds the queue.
    expect(t.engine.getRun(b.id)!.status).toBe("queued");
    expect(m.drainStatus()).toMatchObject({ ready: true, reason: "idle" });
    m.undrain();
    await tick();
    expect(t.engine.getRun(b.id)!.status).toBe("starting");
  });

  it("is cleared by a restart: a new process starts undrained", () => {
    const b1 = box();
    b1.m.drain("ops", 60);
    const again = new Maintenance({ db: b1.db, dataDir: b1.dataDir, workspaceDir: b1.workspaceDir, secretsPath: null, manifest: releaseManifest("1.0.0"), box: () => null, liveRuns: () => 0, queuedRuns: () => 0 });
    expect(again.draining).toBe(false);
  });
});

describe("backup", () => {
  it("copies the database, the config repo (with history, without node_modules) and secrets, private to the box user", async () => {
    const b = box();
    const info = await b.m.backup();
    expect(info.contents).toEqual(["workbench.db", "workspace", "secrets.json"]);
    expect(info.path.startsWith(join(b.dataDir, "backups"))).toBe(true);
    expect(info.name).toMatch(/^\d{4}-\d\d-\d\dT.*-v1\.0\.0$/);
    const copy = new Database(join(info.path, "workbench.db"), { readonly: true });
    expect((copy.prepare("select title from runs").get() as { title: string }).title).toBe("before update");
    expect(git(join(info.path, "workspace"), "log", "--oneline")).toMatch(/init/);
    expect(existsSync(join(info.path, "workspace", "node_modules"))).toBe(false);
    expect(statSync(join(info.path, "secrets.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(b.dataDir, "backups")).mode & 0o777).toBe(0o700);
  });

  it("keeps the newest five, and never the one an update in progress depends on", async () => {
    const b = box();
    const first = await b.m.backup();
    b.m.begin({ to: { version: "2.0.0" }, backup: first.path, by: "test" });
    for (let i = 0; i < 6; i++) await b.m.backup();
    const left = listBackups(b.dataDir).map((x) => x.path);
    expect(left).toHaveLength(6);
    expect(left).toContain(first.path);
    b.m.finish();
    await b.m.backup();
    expect(listBackups(b.dataDir).map((x) => x.path)).not.toContain(first.path);
    expect(readdirSync(join(b.dataDir, "backups"))).toHaveLength(5);
  });
});

describe("rolling back", () => {
  // The newer build: one additive migration, or a breaking one that the older build cannot read past.
  const additive: Migration[] = [...migrations, { version: SCHEMA_VERSION + 1, name: "extra", up: "create table extra (id integer primary key)" }];
  const breaking: Migration[] = [...additive, { version: SCHEMA_VERSION + 2, name: "drop", up: "alter table runs drop column worktree", floor: SCHEMA_VERSION + 2, breaking: { reason: "test", codeStoppedIn: "1.0.0" } }];

  async function updateTo(list: Migration[]) {
    const b = box("1.0.0");
    const bk = await b.m.backup();
    b.m.begin({ to: { version: "2.0.0", schemaVersion: list.at(-1)!.version }, backup: bk.path, by: "test" });
    b.db.close();
    // 2.0.0 starts on the data: migrates, notes the boot, and writes something.
    const db2 = openDb(b.dbPath, { migrations: list });
    db2.prepare("insert into runs (group_id, title, prompt, session_id) values ('g','during update','p','s2')").run();
    db2.close();
    expect(noteBoot(b.dataDir, "2.0.0")!.state).toBe("applied");
    return { ...b, backup: bk };
  }

  it("after an additive update, the old build runs on the new data and needs no restore", async () => {
    const b = await updateTo(additive);
    const db = openDb(b.dbPath);
    expect((db.prepare("select count(*) n from runs").get() as { n: number }).n).toBe(2);
    expect(noteBoot(b.dataDir, "1.0.0")!.state).toBe("rolled-back");
  });

  it("after a breaking update, the old build restores its backup itself and keeps what it replaced", async () => {
    const b = await updateTo(breaking);
    expect(() => openDb(b.dbPath)).toThrow(NewerSchemaError);
    const logs: string[] = [];
    const r = selfRestore({ dataDir: b.dataDir, dbPath: b.dbPath, secretsPath: b.secretsPath, workspaceDir: b.workspaceDir, version: "1.0.0", schemaVersion: SCHEMA_VERSION, configLoads, log: (m) => logs.push(m) });
    expect(r!.restored).toEqual(["workbench.db"]);
    expect(r!.record.state).toBe("restored");
    const db = openDb(b.dbPath);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect((db.prepare("select title from runs").all() as { title: string }[]).map((x) => x.title)).toEqual(["before update"]);
    // The newer database is kept beside the backup.
    const aside = readdirSync(b.backup.path).find((n) => n.startsWith("replaced-"))!;
    expect(existsSync(join(b.backup.path, aside, "workbench.db"))).toBe(true);
    expect(logs.at(-1)).toMatch(/restored workbench.db/);
    // Finishing keeps the outcome, and files the record with its backup.
    const after = new Maintenance({ db, dataDir: b.dataDir, workspaceDir: b.workspaceDir, secretsPath: null, manifest: releaseManifest("1.0.0"), box: () => null, liveRuns: () => 0, queuedRuns: () => 0 });
    expect(after.finish("rolled back")!.state).toBe("restored");
    expect(JSON.parse(readFileSync(join(b.backup.path, "update.json"), "utf8")).log.map((l: { state: string }) => l.state)).toEqual(["pending", "applied", "restored", "restored"]);
    // Secrets and config were readable, so they were left alone.
    expect(JSON.parse(readFileSync(b.secretsPath, "utf8"))).toEqual({ GH: { value: "s1" } });
  });

  it("puts back config.json and secrets.json only when this build cannot read them, as a commit", async () => {
    const b = await updateTo(breaking);
    writeFileSync(join(b.workspaceDir, "config.json"), JSON.stringify({ settings: { limits: { maxConcurrentRuns: "many" } } }));
    git(b.workspaceDir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "newer build's config");
    writeFileSync(b.secretsPath, "v2:binary-format");
    const r = selfRestore({ dataDir: b.dataDir, dbPath: b.dbPath, secretsPath: b.secretsPath, workspaceDir: b.workspaceDir, version: "1.0.0", schemaVersion: SCHEMA_VERSION, configLoads });
    expect(r!.restored).toEqual(["workbench.db", "secrets.json", "config.json"]);
    expect(configLoads(join(b.workspaceDir, "config.json"))).toBe(true);
    expect(git(b.workspaceDir, "log", "--format=%s").split("\n")[0]).toBe("Restore config.json from the backup taken before the update to 2.0.0");
    expect(git(b.workspaceDir, "status", "--porcelain").trim()).toBe("");
    expect(JSON.parse(readFileSync(b.secretsPath, "utf8"))).toEqual({ GH: { value: "s1" } });
  });

  it("restores nothing without an update in progress, or with a backup it cannot read", async () => {
    const b = await updateTo(breaking);
    const o = { dataDir: b.dataDir, dbPath: b.dbPath, secretsPath: b.secretsPath, workspaceDir: b.workspaceDir, version: "0.9.0", configLoads };
    // A build older than the one that took the backup.
    expect(selfRestore({ ...o, schemaVersion: SCHEMA_VERSION - 1 })).toBeNull();
    // The update finished: a later NewerSchemaError is not a rollback.
    new Maintenance({ db: openDb(":memory:"), dataDir: b.dataDir, workspaceDir: b.workspaceDir, secretsPath: null, manifest: releaseManifest("2.0.0"), box: () => null, liveRuns: () => 0, queuedRuns: () => 0 }).finish();
    expect(readUpdateRecord(b.dataDir)).toBeNull();
    expect(selfRestore({ ...o, schemaVersion: SCHEMA_VERSION })).toBeNull();
  });
});
