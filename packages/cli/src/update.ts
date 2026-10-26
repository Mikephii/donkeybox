// wb update: moves a box to another release through its management API and a platform driver, and
// puts the old image back if the new one does not come up healthy. The steps are the contract in
// docs/hosting/updating.md; a hosted control plane calls the same endpoints.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface Manifest {
  version: string;
  schemaVersion: number;
  compatFloor: number;
  minUpgradeFrom: string;
  capabilities?: string[];
}

export interface Info extends Partial<Manifest> {
  version: string;
  schemaVersion: number;
  data?: { schemaVersion: number; compatFloor: number; newerThanBuild: boolean } | null;
  box?: { id?: string; name?: string };
}

/** The platform side: how to read the running image, snapshot the volume and swap the image. */
export interface Driver {
  name: string;
  currentImage(): string | null;
  /** A provider snapshot of the data volume; returns false when the platform has none. */
  snapshot(label: string): boolean;
  /** Points the deployment at `image` and restarts the box on it. Returns once the swap is issued. */
  swap(image: string): void;
  /** The release manifest inside an image, when the platform can read it. */
  manifest(image: string): Manifest | null;
}

export interface Api {
  get(path: string): Promise<any>;
  post(path: string, body?: unknown): Promise<any>;
}

export interface UpdateOptions {
  to: string;
  image?: string;
  manifest?: Manifest;
  /** Seconds to wait for the new version to report healthy before putting the old one back. */
  timeout: number;
  /** Seconds to wait for live runs to finish while draining. */
  drainTimeout: number;
  /** Milliseconds between polls. */
  interval: number;
  dryRun?: boolean;
  by?: string;
}

export type Outcome =
  | { result: "updated"; from: string; to: string }
  | { result: "already"; version: string }
  | { result: "stopped"; reason: string }
  | { result: "rolled-back"; from: string; to: string; restored: boolean; reason: string }
  | { result: "stuck"; reason: string };

export const EXIT: Record<Outcome["result"], number> = { updated: 0, already: 0, stopped: 1, "rolled-back": 2, stuck: 3 };

/** Numeric dotted versions; a pre-release sorts before its release. Same rules as the app's release.ts. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core!.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
const isRelease = (v: string) => /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v);

/** The same repository with another tag: ghcr.io/acme/workbench:0.3.0 -> ghcr.io/acme/workbench:0.4.0. */
export function retag(image: string, version: string): string {
  const at = image.indexOf("@");
  const base = at >= 0 ? image.slice(0, at) : image;
  const colon = base.lastIndexOf(":");
  const repo = colon > base.lastIndexOf("/") ? base.slice(0, colon) : base;
  return `${repo}:${version}`;
}

/**
 * Whether the target can run, and whether the build being replaced could be put back on its data.
 * Returns the reason to stop, or null to go ahead.
 */
export function preflight(from: Info, target: Manifest): string | null {
  if (!isRelease(from.version)) return `the box runs ${from.version}, not a release; update it by hand`;
  if (compareVersions(from.version, target.minUpgradeFrom) < 0)
    return `${target.version} can only be reached from ${target.minUpgradeFrom} or later; update to ${target.minUpgradeFrom} first`;
  const data = from.data ?? { schemaVersion: from.schemaVersion, compatFloor: from.compatFloor ?? from.schemaVersion, newerThanBuild: false };
  if (data.compatFloor > target.schemaVersion) return `the box's data needs schema ${data.compatFloor} or later and ${target.version} is schema ${target.schemaVersion}`;
  const caps = from.capabilities ?? [];
  // A build that cannot restore its own backup must never be left behind data it cannot read.
  if (!caps.includes("self-restore") && target.compatFloor > from.schemaVersion && target.schemaVersion > from.schemaVersion)
    return `${from.version} cannot restore itself if ${target.version} fails (it changes the database to schema ${target.schemaVersion}); update to a release with self-restore first`;
  return null;
}

/** Whether putting the old build back needs its backup restored. */
export const needsRestore = (from: Info, target: Manifest) => target.compatFloor > from.schemaVersion;

export async function runUpdate(o: UpdateOptions, api: Api, driver: Driver, log: (m: string) => void, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Outcome> {
  const tryGet = async (path: string) => {
    try {
      return await api.get(path);
    } catch {
      return null;
    }
  };
  const info: Info = await api.get("/v1/info");
  const record = (await tryGet("/v1/update"))?.record ?? null;
  log(`box ${info.box?.name ?? "?"} (${info.box?.id ?? "?"}) runs ${info.version}, schema ${info.schemaVersion}${info.data?.newerThanBuild ? ` on data from a newer build (schema ${info.data.schemaVersion})` : ""}`);

  // Rerun after the swap already happened: only the check and the finish are left.
  if (info.version === o.to) {
    if (record && (record.state === "applied" || record.state === "pending")) {
      log(`already on ${o.to} with update ${record.id} ${record.state}; checking health and finishing`);
      const h = await tryGet("/v1/health");
      if (h?.ok && h.version === o.to) {
        if (!o.dryRun) await api.post("/v1/update/finish", { note: `${o.to} healthy (rerun)` });
        return { result: "updated", from: record.from.version, to: o.to };
      }
      return { result: "stuck", reason: `${o.to} is running but not healthy; rerun, or put back ${record.from.version}` };
    }
    log(`already on ${o.to}`);
    return { result: "already", version: o.to };
  }

  const current = driver.currentImage();
  const image = o.image ?? (current ? retag(current, o.to) : null);
  if (!image) return { result: "stopped", reason: "cannot tell which image to run; pass --image" };
  const target = o.manifest ?? driver.manifest(image);
  if (!target) return { result: "stopped", reason: `no release manifest for ${o.to}; pass --manifest dist/workbench-${o.to}.release.json` };
  if (target.version !== o.to) return { result: "stopped", reason: `the manifest is for ${target.version}, not ${o.to}` };
  const why = preflight(info, target);
  if (why) return { result: "stopped", reason: why };
  const caps = info.capabilities ?? [];
  const restore = needsRestore(info, target);
  log(`target ${image}: schema ${target.schemaVersion}, compat floor ${target.compatFloor}, upgrades from ${target.minUpgradeFrom}`);
  log(restore ? `${info.version} cannot read ${o.to}'s data; if ${o.to} fails, ${info.version} restores the backup taken now` : `${info.version} can run on ${o.to}'s data; if ${o.to} fails, putting ${info.version} back is enough`);
  if (o.dryRun) return { result: "stopped", reason: "dry run: nothing changed" };

  // 1. Drain: no new runs start; wait for live ones (or the drain timeout).
  if (caps.includes("drain")) {
    let d = await api.post("/v1/drain", { timeoutSeconds: o.drainTimeout, by: o.by ?? "wb update" });
    log(`draining: ${d.liveRuns} live run(s), ${d.queuedRuns} queued`);
    while (!d.ready) {
      await sleep(o.interval);
      d = await api.get("/v1/drain");
    }
    log(d.reason === "idle" ? "drained: no live runs" : `drain timeout passed with ${d.liveRuns} live run(s); they are interrupted by the restart and can be resumed`);
  } else log(`${info.version} cannot drain; live runs are interrupted by the restart and can be resumed`);

  const abandon = async (reason: string): Promise<Outcome> => {
    if (caps.includes("drain")) await api.post("/v1/undrain", {}).catch(() => {});
    return { result: "stopped", reason };
  };

  // 2. Backup on the volume, and the record an older build reads if it is put back.
  let backup: string | null = null;
  if (caps.includes("backup")) {
    if (record && (record.state === "pending" || record.state === "applied") && record.to.version === o.to) {
      backup = record.backup;
      log(`reusing backup ${backup} from update ${record.id}`);
    } else {
      try {
        backup = (await api.post("/v1/backup", {})).path;
        log(`backup ${backup}`);
      } catch (e) {
        return abandon(`backup failed: ${(e as Error).message}`);
      }
    }
    if (caps.includes("update-record")) {
      try {
        const r = await api.post("/v1/update/begin", { to: { version: target.version, schemaVersion: target.schemaVersion, compatFloor: target.compatFloor }, backup, by: o.by ?? "wb update" });
        log(`update ${r.id} recorded on the box`);
      } catch (e) {
        return abandon(`could not record the update: ${(e as Error).message}`);
      }
    }
  } else if (restore) return abandon(`${info.version} cannot take a backup, and ${o.to} changes the database`);

  // 3. Provider snapshot of the whole volume, when the platform has one.
  const snap = driver.snapshot(`before-${o.to}`);
  log(snap ? "volume snapshot taken" : backup ? `${driver.name}: no volume snapshot; the box's backup is the fallback` : `${driver.name}: no volume snapshot and no backup (${info.version} cannot take one); the update changes no schema, so putting ${info.version} back is the fallback`);

  // 4. Swap and wait for the new version to report healthy.
  const old = current ?? retag(image, info.version);
  log(`swapping ${old} -> ${image}`);
  try {
    driver.swap(image);
  } catch (e) {
    log(`swap failed: ${(e as Error).message}`);
  }
  if (await waitFor(o.to)) {
    await api.post("/v1/update/finish", { note: `${o.to} healthy` }).catch(() => {});
    log(`updated to ${o.to}`);
    return { result: "updated", from: info.version, to: o.to };
  }

  // 5. Not healthy in time: put the old image back. The old build restores its backup itself when needed.
  const reason = `${o.to} did not report healthy within ${o.timeout}s`;
  log(`${reason}; putting ${old} back`);
  try {
    driver.swap(old);
  } catch (e) {
    return { result: "stuck", reason: `${reason}, and putting ${old} back failed: ${(e as Error).message}. Restore the volume snapshot.` };
  }
  if (!(await waitFor(info.version))) return { result: "stuck", reason: `${reason}, and ${info.version} did not come back either. Restore the volume snapshot taken before the update.` };
  const rec = (await tryGet("/v1/update"))?.record;
  const restored = rec?.state === "restored";
  if (rec) log(`box says: ${rec.log?.at(-1)?.note ?? rec.state}`);
  await api.post("/v1/update/finish", { note: `rolled back: ${reason}` }).catch(() => {});
  log(`rolled back to ${info.version}${restored ? " and restored the backup" : ""}`);
  return { result: "rolled-back", from: info.version, to: o.to, restored, reason };

  async function waitFor(version: string): Promise<boolean> {
    const until = Date.now() + o.timeout * 1000;
    while (Date.now() < until) {
      await sleep(o.interval);
      const h = await tryGet("/v1/health");
      if (h?.ok && h.version === version) return true;
    }
    return false;
  }
}

// ── the command ──

export function httpApi(url: string, token: string): Api {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const t = await r.text();
    const d = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
    return d;
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b ?? {}) };
}

/** A driver is a script: `<script> current-image | snapshot LABEL | swap IMAGE | manifest IMAGE`. */
export function scriptDriver(name: string, script: string): Driver {
  const run = (args: string[], inherit = false) => {
    const r = spawnSync(script, args, { encoding: "utf8", stdio: inherit ? ["inherit", "inherit", "inherit"] : ["ignore", "pipe", "inherit"] });
    return { code: r.status ?? 1, out: (r.stdout ?? "").trim() };
  };
  return {
    name,
    currentImage: () => {
      const r = run(["current-image"]);
      return r.code === 0 && r.out ? r.out : null;
    },
    snapshot: (label) => run(["snapshot", label], true).code === 0,
    swap: (image) => {
      const r = run(["swap", image], true);
      if (r.code !== 0) throw new Error(`${script} swap exited ${r.code}`);
    },
    manifest: (image) => {
      const r = run(["manifest", image]);
      try {
        return r.code === 0 ? JSON.parse(r.out) : null;
      } catch {
        return null;
      }
    },
  };
}

export async function updateCommand(args: { to?: string; via?: string; image?: string; manifest?: string; timeout?: string; "drain-timeout"?: string; "dry-run"?: boolean; url?: string; driver?: string }, root: string): Promise<number> {
  if (!args.to) throw new Error("--to VERSION is required");
  const token = process.env.WB_MANAGEMENT_TOKEN;
  if (!token) throw new Error("set WB_MANAGEMENT_TOKEN to the box's management token");
  const url = args.url ?? process.env.WB_MANAGEMENT_URL ?? "http://127.0.0.1:8002";
  const via = args.via ?? (args.driver ? "custom" : "");
  if (!via) throw new Error("--via compose|gcp|fly (or --driver SCRIPT) is required");
  const script = args.driver ? resolve(args.driver) : join(root, "deploy", via, "update.sh");
  if (!existsSync(script)) throw new Error(`no driver script at ${script}`);
  // --manifest, else the one beside a checkout's tarball, else the release folder's own (when it is that release).
  const candidates = args.manifest ? [args.manifest] : [join(root, "dist", `workbench-${args.to}.release.json`), join(root, "release.json")];
  const manifest = candidates
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, "utf8")) as Manifest)
    .find((m) => args.manifest || m.version === args.to);
  const logDir = process.env.WB_UPDATE_LOG_DIR ?? join(homedir(), ".workbench", "updates");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${new Date().toISOString().slice(0, 10)}-${args.to}.log`);
  mkdirSync(dirname(logFile), { recursive: true });
  const log = (m: string) => {
    const line = `${new Date().toISOString()} ${m}`;
    console.log(line);
    appendFileSync(logFile, line + "\n");
  };
  log(`wb update --to ${args.to} --via ${via} (${url}); log in ${logFile}`);
  const outcome = await runUpdate(
    {
      to: args.to,
      image: args.image,
      manifest,
      timeout: Number(args.timeout ?? 600),
      drainTimeout: Number(args["drain-timeout"] ?? 900),
      interval: Number(process.env.WB_UPDATE_POLL_MS ?? 3000),
      dryRun: args["dry-run"],
      by: `wb update (${process.env.USER ?? "someone"})`,
    },
    httpApi(url, token),
    scriptDriver(via, script),
    log,
  );
  log(`result: ${outcome.result}${"reason" in outcome ? `: ${outcome.reason}` : ""}`);
  return EXIT[outcome.result];
}
