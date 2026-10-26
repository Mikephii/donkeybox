import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DB } from "../engine/db.ts";
import type { ReleaseManifest } from "../release.ts";

/**
 * What the update routine needs from a running box: drain (stop starting runs), a backup it can
 * restore from, and a record of the update in progress that an older build reads if it is put back.
 * The routine itself (`wb update`, or a hosted control plane) drives these through the management API.
 */

export interface DrainStatus {
  draining: boolean;
  since: string | null;
  by: string | null;
  /** When the routine stops waiting for live runs, whether or not they finished. */
  deadline: string | null;
  liveRuns: number;
  queuedRuns: number;
  /** Safe to swap the image: no live runs, or the deadline passed. */
  ready: boolean;
  reason: "idle" | "timeout" | null;
}

export interface BackupInfo {
  path: string;
  name: string;
  createdAt: string;
  version: string;
  schemaVersion: number;
  compatFloor: number;
  box: string | null;
  contents: string[];
}

export type UpdateState = "pending" | "applied" | "rolled-back" | "restored" | "done" | "abandoned";

export interface UpdateRecord {
  id: string;
  state: UpdateState;
  startedAt: string;
  updatedAt: string;
  from: { version: string; schemaVersion: number; compatFloor: number };
  to: { version: string; schemaVersion?: number; compatFloor?: number };
  backup: string;
  by: string;
  log: { at: string; state: UpdateState; note: string }[];
}

export class UpdateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
export const BACKUP_KEEP = 5;
export const DEFAULT_DRAIN_SECONDS = 15 * 60;

export const backupsDir = (dataDir: string) => join(dataDir, "backups");
export const updateRecordPath = (dataDir: string) => join(dataDir, "update.json");

export function readUpdateRecord(dataDir: string): UpdateRecord | null {
  try {
    return JSON.parse(readFileSync(updateRecordPath(dataDir), "utf8"));
  } catch {
    return null;
  }
}

function writeUpdateRecord(dataDir: string, r: UpdateRecord) {
  const p = updateRecordPath(dataDir);
  writeFileSync(`${p}.tmp`, JSON.stringify(r, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
}

function step(r: UpdateRecord, state: UpdateState, note: string): UpdateRecord {
  const at = now();
  return { ...r, state, updatedAt: at, log: [...r.log, { at, state, note }] };
}

/** An update that has started and not finished: the backup it names must be kept. */
export const inProgress = (r: UpdateRecord | null) => !!r && (r.state === "pending" || r.state === "applied");

export interface MaintenanceOptions {
  db: DB;
  dataDir: string;
  workspaceDir: string;
  /** The file secrets store, or null when secrets live elsewhere (Secret Manager). */
  secretsPath: string | null;
  manifest: ReleaseManifest;
  box: () => string | null;
  liveRuns: () => number;
  queuedRuns: () => number;
  /** Something changed that pages show (the drain banner). */
  onChange?: () => void;
  log?: (m: string) => void;
  keep?: number;
}

export class Maintenance {
  private o: MaintenanceOptions;
  // In memory on purpose: a restart (the image swap, or a person restarting the box) clears it.
  private drainState: { since: string; by: string; deadline: string } | null = null;

  constructor(o: MaintenanceOptions) {
    this.o = o;
  }

  // ── drain ──

  drain(by: string, timeoutSeconds = DEFAULT_DRAIN_SECONDS): DrainStatus {
    const t = Math.max(0, Math.min(Number(timeoutSeconds) || 0, 24 * 3600));
    if (!this.drainState) this.drainState = { since: now(), by, deadline: new Date(Date.now() + t * 1000).toISOString() };
    else this.drainState.deadline = new Date(Date.now() + t * 1000).toISOString();
    this.o.log?.(`draining for an update (by ${by}, waiting up to ${t}s for live runs)`);
    this.o.onChange?.();
    return this.drainStatus();
  }

  undrain(): DrainStatus {
    if (this.drainState) this.o.log?.("drain ended; queued runs start again");
    this.drainState = null;
    this.o.onChange?.();
    return this.drainStatus();
  }

  get draining() {
    return !!this.drainState;
  }

  drainStatus(): DrainStatus {
    const d = this.drainState;
    const liveRuns = this.o.liveRuns();
    const timedOut = !!d && Date.now() >= Date.parse(d.deadline);
    const reason = !d ? null : liveRuns === 0 ? "idle" : timedOut ? "timeout" : null;
    return { draining: !!d, since: d?.since ?? null, by: d?.by ?? null, deadline: d?.deadline ?? null, liveRuns, queuedRuns: this.o.queuedRuns(), ready: !!reason, reason };
  }

  /** Why queued runs wait, for the engine's limits. */
  blockedReason(): string | null {
    return this.drainState ? "the box is getting ready for an update; queued runs start after it" : null;
  }

  // ── backup ──

  async backup(): Promise<BackupInfo> {
    const root = backupsDir(this.o.dataDir);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const createdAt = now();
    let name = `${createdAt.replace(/[:.]/g, "-")}-v${this.o.manifest.version}`;
    for (let i = 2; existsSync(join(root, name)); i++) name = `${name.replace(/~\d+$/, "")}~${i}`;
    const dir = join(root, name);
    const tmp = `${dir}.partial`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true, mode: 0o700 });
    const contents: string[] = [];
    try {
      // SQLite's online backup: a consistent copy while the app keeps writing.
      await this.o.db.backup(join(tmp, "workbench.db"));
      contents.push("workbench.db");
      if (existsSync(this.o.workspaceDir)) {
        cpSync(this.o.workspaceDir, join(tmp, "workspace"), { recursive: true, verbatimSymlinks: true, filter: (src) => basename(src) !== "node_modules" && !src.startsWith(this.o.dataDir) });
        contents.push("workspace");
      }
      if (this.o.secretsPath && existsSync(this.o.secretsPath)) {
        copyFileSync(this.o.secretsPath, join(tmp, "secrets.json"));
        chmodSync(join(tmp, "secrets.json"), 0o600);
        contents.push("secrets.json");
      }
      const info: BackupInfo = {
        path: dir,
        name,
        createdAt,
        version: this.o.manifest.version,
        schemaVersion: this.o.manifest.schemaVersion,
        compatFloor: this.o.manifest.compatFloor,
        box: this.o.box(),
        contents,
      };
      writeFileSync(join(tmp, "backup.json"), JSON.stringify(info, null, 2) + "\n");
      renameSync(tmp, dir);
      this.o.log?.(`backup written to ${dir} (${contents.join(", ")})`);
      this.prune();
      return info;
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  listBackups(): BackupInfo[] {
    return listBackups(this.o.dataDir);
  }

  /** Keeps the newest `keep` backups, and always the one an update in progress depends on. */
  private prune() {
    const keep = this.o.keep ?? BACKUP_KEEP;
    const rec = readUpdateRecord(this.o.dataDir);
    const pinned = inProgress(rec) ? rec!.backup : null;
    const all = this.listBackups();
    for (const b of all.slice(0, Math.max(0, all.length - keep))) if (b.path !== pinned) rmSync(b.path, { recursive: true, force: true });
  }

  // ── the update record ──

  record(): UpdateRecord | null {
    return readUpdateRecord(this.o.dataDir);
  }

  /**
   * Starts (or, rerun with the same target, continues) an update. Needs a backup taken by this build;
   * an older build put back later reads this record to decide whether to restore it.
   */
  begin(o: { to: { version: string; schemaVersion?: number; compatFloor?: number }; backup: string; by: string }): UpdateRecord {
    const cur = this.record();
    if (inProgress(cur) && cur!.to.version === o.to.version && cur!.from.version === this.o.manifest.version) return cur!;
    const b = this.listBackups().find((x) => x.path === o.backup || x.name === o.backup);
    if (!b) throw new UpdateError(422, `no backup ${o.backup}; take one with POST /v1/backup first`);
    if (b.version !== this.o.manifest.version || b.schemaVersion !== this.o.manifest.schemaVersion)
      throw new UpdateError(422, `backup ${b.name} was taken by ${b.version} (schema ${b.schemaVersion}); take a new one on this build`);
    // A finished or rolled-back record from an earlier attempt goes into its own backup folder.
    if (cur && !inProgress(cur) && existsSync(cur.backup)) writeFileSync(join(cur.backup, "update.json"), JSON.stringify(cur, null, 2) + "\n");
    if (inProgress(cur)) throw new UpdateError(409, `update ${cur!.id} to ${cur!.to.version} is still in progress; finish it first`);
    const at = now();
    const m = this.o.manifest;
    const rec: UpdateRecord = {
      id: `upd_${at.replace(/\D/g, "").slice(0, 14)}`,
      state: "pending",
      startedAt: at,
      updatedAt: at,
      from: { version: m.version, schemaVersion: m.schemaVersion, compatFloor: m.compatFloor },
      to: o.to,
      backup: b.path,
      by: o.by,
      log: [{ at, state: "pending", note: `update from ${m.version} to ${o.to.version} started by ${o.by}; backup ${b.name}` }],
    };
    writeUpdateRecord(this.o.dataDir, rec);
    this.o.log?.(rec.log[0]!.note);
    return rec;
  }

  /** The routine saw the box healthy on the version it wanted; the record moves into its backup folder. */
  finish(note = "finished"): UpdateRecord | null {
    const cur = this.record();
    if (!cur) return null;
    // Applied and confirmed: done. Rolled back or restored: that stays the outcome. Anything else never got going.
    const final: UpdateState = cur.state === "applied" || cur.to.version === this.o.manifest.version ? "done" : cur.state === "rolled-back" || cur.state === "restored" ? cur.state : "abandoned";
    const done = step(cur, final, note);
    if (existsSync(cur.backup)) writeFileSync(join(cur.backup, "update.json"), JSON.stringify(done, null, 2) + "\n");
    rmSync(updateRecordPath(this.o.dataDir), { force: true });
    this.o.log?.(`update ${cur.id} ${done.state}: ${note}`);
    return done;
  }
}

export function listBackups(dataDir: string): BackupInfo[] {
  const root = backupsDir(dataDir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => !n.endsWith(".partial"))
    .flatMap((n) => {
      try {
        return [{ ...(JSON.parse(readFileSync(join(root, n, "backup.json"), "utf8")) as BackupInfo), path: join(root, n), name: n }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Called at start, after the database opened. Moves an update in progress along: the target build
 * marks it applied, the build it came from marks it rolled back.
 */
export function noteBoot(dataDir: string, version: string, log: (m: string) => void = () => {}): UpdateRecord | null {
  const cur = readUpdateRecord(dataDir);
  if (!inProgress(cur)) return cur;
  let next: UpdateRecord | null = null;
  if (cur!.to.version === version && cur!.state === "pending") next = step(cur!, "applied", `${version} started on the data`);
  else if (cur!.from.version === version) next = step(cur!, "rolled-back", `${version} is running again; the update to ${cur!.to.version} did not stay`);
  if (next) {
    writeUpdateRecord(dataDir, next);
    log(`update ${next.id}: ${next.log.at(-1)!.note}`);
  }
  return next ?? cur;
}

export interface RestoreOptions {
  dataDir: string;
  dbPath: string;
  secretsPath: string | null;
  workspaceDir: string;
  version: string;
  schemaVersion: number;
  /** Whether this build can load a config.json (used to decide whether to put the backup's back). */
  configLoads: (path: string) => boolean;
  log?: (m: string) => void;
}

/**
 * A build put back after a failed update finds a database it cannot read. If an update record says an
 * update from a build like this one is in progress, it restores the backup taken before it:
 *   the database always (the one it cannot read is kept beside the backup);
 *   secrets.json only when the current one is not readable;
 *   config.json only when this build cannot load the current one, as a commit, so the box's config
 *   history stays one line and its remote does not diverge.
 * Returns what it did, or null when there is nothing it may restore (the caller then refuses to start).
 */
export function selfRestore(o: RestoreOptions): { record: UpdateRecord; restored: string[] } | null {
  const log = o.log ?? (() => {});
  const cur = readUpdateRecord(o.dataDir);
  if (!inProgress(cur)) return null;
  const b = listBackups(o.dataDir).find((x) => x.path === cur!.backup);
  if (!b || !b.contents.includes("workbench.db")) {
    log(`update ${cur!.id} names backup ${cur!.backup}, which is missing; restore the volume's snapshot instead`);
    return null;
  }
  // Only a backup this build can read: written at or below its schema, with a floor it meets.
  if (b.schemaVersion > o.schemaVersion || b.compatFloor > o.schemaVersion) {
    log(`backup ${b.name} is schema ${b.schemaVersion} (floor ${b.compatFloor}); this build is schema ${o.schemaVersion} and cannot restore it`);
    return null;
  }
  const aside = join(b.path, `replaced-${now().replace(/[:.]/g, "-")}`);
  mkdirSync(aside, { recursive: true, mode: 0o700 });
  const restored: string[] = [];
  for (const ext of ["", "-wal", "-shm"]) if (existsSync(o.dbPath + ext)) renameSync(o.dbPath + ext, join(aside, basename(o.dbPath) + ext));
  copyFileSync(join(b.path, "workbench.db"), o.dbPath);
  restored.push("workbench.db");
  if (o.secretsPath && b.contents.includes("secrets.json")) {
    let readable = false;
    try {
      const s = JSON.parse(readFileSync(o.secretsPath, "utf8"));
      readable = !!s && typeof s === "object";
    } catch {}
    if (!readable) {
      if (existsSync(o.secretsPath)) renameSync(o.secretsPath, join(aside, "secrets.json"));
      copyFileSync(join(b.path, "secrets.json"), o.secretsPath);
      chmodSync(o.secretsPath, 0o600);
      restored.push("secrets.json");
    }
  }
  const cfg = join(o.workspaceDir, "config.json");
  const backupCfg = join(b.path, "workspace", "config.json");
  if (b.contents.includes("workspace") && existsSync(backupCfg) && !o.configLoads(cfg)) {
    if (existsSync(cfg)) copyFileSync(cfg, join(aside, "config.json"));
    copyFileSync(backupCfg, cfg);
    try {
      execFileSync("git", ["-C", o.workspaceDir, "add", "config.json"], { stdio: "ignore" });
      execFileSync("git", ["-C", o.workspaceDir, "-c", "user.name=Workbench", "-c", "user.email=workbench@workbench.local", "commit", "-q", "-m", `Restore config.json from the backup taken before the update to ${cur!.to.version}`], { stdio: "ignore" });
    } catch {}
    restored.push("config.json");
  }
  const rec = step(cur!, "restored", `${o.version} restored ${restored.join(", ")} from ${b.name}; what it replaced is in ${aside}`);
  writeUpdateRecord(o.dataDir, rec);
  log(rec.log.at(-1)!.note);
  return { record: rec, restored };
}
