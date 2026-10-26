import { describe, expect, it } from "vitest";
import { preflight, retag, runUpdate, type Api, type Driver, type Manifest } from "../../cli/src/update.ts";

const CAPS = ["drain", "backup", "update-record", "self-restore", "compat-floor"];
const rel = (version: string, o: Partial<Manifest> = {}): Manifest => ({ version, schemaVersion: 4, compatFloor: 1, minUpgradeFrom: "0.3.0", capabilities: CAPS, ...o });

/**
 * A box as the routine sees it: images by tag, each healthy or not, and a management API on whichever
 * image is running. A breaking target leaves data the old image restores from its backup.
 */
function fakeBox(o: { from: Manifest; images: Record<string, { manifest: Manifest; healthy: boolean }>; liveRuns?: number }) {
  let image = `ghcr.io/acme/workbench:${o.from.version}`;
  const calls: string[] = [];
  let drain = { draining: false, liveRuns: o.liveRuns ?? 0, polls: 0 };
  let record: any = null;
  const running = () => o.images[image.split(":").pop()!]!;
  const api: Api = {
    async get(path) {
      const r = running();
      if (!r.healthy) throw new Error("connection refused");
      calls.push(`GET ${path}`);
      if (path === "/v1/info") return { ...r.manifest, data: null, box: { id: "box_1", name: "Acme" } };
      if (path === "/v1/health") return { ok: true, version: r.manifest.version };
      if (path === "/v1/update") return { record };
      if (path === "/v1/drain") {
        drain.polls++;
        if (drain.polls >= 2) drain.liveRuns = 0;
        return { draining: drain.draining, liveRuns: drain.liveRuns, queuedRuns: 0, ready: drain.liveRuns === 0, reason: drain.liveRuns === 0 ? "idle" : null };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, body: any) {
      const r = running();
      if (!r.healthy) throw new Error("connection refused");
      calls.push(`POST ${path}`);
      if (path === "/v1/drain") return ((drain.draining = true), { draining: true, liveRuns: drain.liveRuns, queuedRuns: 1, ready: drain.liveRuns === 0, reason: drain.liveRuns ? null : "idle" });
      if (path === "/v1/undrain") return ((drain.draining = false), { draining: false });
      if (path === "/v1/backup") return { path: "/data/internal/backups/b1" };
      if (path === "/v1/update/begin") return (record = { id: "upd_1", state: "pending", from: { version: o.from.version }, to: body.to, backup: body.backup, log: [] });
      if (path === "/v1/update/finish") return ((record = null), { record: null });
      throw new Error(`unexpected POST ${path}`);
    },
  };
  const driver: Driver = {
    name: "fake",
    currentImage: () => image,
    snapshot: (label) => (calls.push(`snapshot ${label}`), true),
    swap: (img) => {
      calls.push(`swap ${img}`);
      image = img;
      // Booting: the target marks the record applied; the old build back on breaking data restores.
      const r = running();
      if (record && r.healthy && r.manifest.version === record.to.version) record.state = "applied";
      if (record && r.manifest.version === record.from.version)
        record = { ...record, state: (record.to.compatFloor ?? 1) > r.manifest.schemaVersion ? "restored" : "rolled-back", log: [{ note: "box note" }] };
      drain = { ...drain, draining: false };
    },
    manifest: (img) => o.images[img.split(":").pop()!]?.manifest ?? null,
  };
  return { api, driver, calls, image: () => image, record: () => record };
}

const opts = { timeout: 0.05, drainTimeout: 60, interval: 1 };
const noSleep = () => Promise.resolve();

describe("wb update", () => {
  it("drains, backs up, records, snapshots, swaps and finishes when the new version is healthy", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.5.0": { manifest: rel("0.5.0", { schemaVersion: 5 }), healthy: true } }, liveRuns: 1 });
    const log: string[] = [];
    const out = await runUpdate({ ...opts, to: "0.5.0" }, b.api, b.driver, (m) => log.push(m), noSleep);
    expect(out).toEqual({ result: "updated", from: "0.4.0", to: "0.5.0" });
    expect(b.calls.filter((c) => !c.startsWith("GET /v1/health") && c !== "GET /v1/drain")).toEqual([
      "GET /v1/info", "GET /v1/update", "POST /v1/drain", "POST /v1/backup", "POST /v1/update/begin", "snapshot before-0.5.0", "swap ghcr.io/acme/workbench:0.5.0", "POST /v1/update/finish",
    ]);
    expect(log.some((l) => l.includes("0.4.0 can run on 0.5.0's data"))).toBe(true);
    expect(log.some((l) => l === "drained: no live runs")).toBe(true);
  });

  it("puts the old image back when the new one never reports healthy; additive data needs no restore", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.5.0": { manifest: rel("0.5.0", { schemaVersion: 5 }), healthy: false } } });
    const out = await runUpdate({ ...opts, to: "0.5.0" }, b.api, b.driver, () => {}, noSleep);
    expect(out).toMatchObject({ result: "rolled-back", restored: false });
    expect(b.image()).toBe("ghcr.io/acme/workbench:0.4.0");
    expect(b.calls).toContain("swap ghcr.io/acme/workbench:0.4.0");
    expect(b.record()).toBeNull();
  });

  it("after a failed breaking update, the old build restores its backup and the routine reports it", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.5.0": { manifest: rel("0.5.0", { schemaVersion: 6, compatFloor: 6 }), healthy: false } } });
    const log: string[] = [];
    const out = await runUpdate({ ...opts, to: "0.5.0" }, b.api, b.driver, (m) => log.push(m), noSleep);
    expect(out).toMatchObject({ result: "rolled-back", restored: true });
    expect(log.some((l) => l.includes("0.4.0 cannot read 0.5.0's data; if 0.5.0 fails, 0.4.0 restores the backup"))).toBe(true);
  });

  it("stops before touching anything when the jump is too large or the old build could not be put back", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.9.0": { manifest: rel("0.9.0", { minUpgradeFrom: "0.6.0" }), healthy: true } } });
    expect(await runUpdate({ ...opts, to: "0.9.0" }, b.api, b.driver, () => {}, noSleep)).toEqual({ result: "stopped", reason: "0.9.0 can only be reached from 0.6.0 or later; update to 0.6.0 first" });
    expect(b.calls.filter((c) => c.startsWith("POST") || c.startsWith("swap"))).toEqual([]);
    // 0.3.0 has no self-restore: a target it cannot read is refused.
    expect(preflight({ version: "0.3.0", schemaVersion: 4 }, rel("0.5.0", { schemaVersion: 6, compatFloor: 6 }))).toMatch(/cannot restore itself/);
    // A target on the same schema is fine from 0.3.0: putting 0.3.0 back needs no restore.
    expect(preflight({ version: "0.3.0", schemaVersion: 4 }, rel("0.4.0"))).toBeNull();
    expect(preflight({ version: "dev", schemaVersion: 4 }, rel("0.4.0"))).toMatch(/not a release/);
    expect(preflight({ version: "0.4.0", schemaVersion: 4, data: { schemaVersion: 7, compatFloor: 7, newerThanBuild: true } }, rel("0.4.1"))).toMatch(/needs schema 7/);
  });

  it("from a build without drain or backup (0.3.0) it still swaps and can swap back", async () => {
    const old = rel("0.3.0", { capabilities: undefined as any });
    const b = fakeBox({ from: old, images: { "0.3.0": { manifest: old, healthy: true }, "0.4.0": { manifest: rel("0.4.0"), healthy: true } } });
    const log: string[] = [];
    expect(await runUpdate({ ...opts, to: "0.4.0" }, b.api, b.driver, (m) => log.push(m), noSleep)).toMatchObject({ result: "updated" });
    expect(b.calls).not.toContain("POST /v1/drain");
    expect(log).toContain("0.3.0 cannot drain; live runs are interrupted by the restart and can be resumed");
  });

  it("a rerun after the swap finishes the update; a rerun on the target with nothing in progress does nothing", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.5.0": { manifest: rel("0.5.0"), healthy: true } } });
    await b.api.post("/v1/update/begin", { to: { version: "0.5.0" }, backup: "/b" });
    b.driver.swap("ghcr.io/acme/workbench:0.5.0");
    expect(await runUpdate({ ...opts, to: "0.5.0" }, b.api, b.driver, () => {}, noSleep)).toEqual({ result: "updated", from: "0.4.0", to: "0.5.0" });
    expect(b.record()).toBeNull();
    expect(await runUpdate({ ...opts, to: "0.5.0" }, b.api, b.driver, () => {}, noSleep)).toEqual({ result: "already", version: "0.5.0" });
  });

  it("reports stuck, with what to do, when neither image comes up", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.5.0": { manifest: rel("0.5.0"), healthy: false } } });
    const swap = b.driver.swap;
    b.driver.swap = (img) => {
      swap(img);
      if (img.endsWith("0.4.0")) throw new Error("registry down");
    };
    const out = await runUpdate({ ...opts, to: "0.5.0" }, b.api, b.driver, () => {}, noSleep);
    expect(out.result).toBe("stuck");
    expect((out as any).reason).toMatch(/Restore the volume snapshot/);
  });

  it("a dry run reads and checks but changes nothing", async () => {
    const b = fakeBox({ from: rel("0.4.0"), images: { "0.4.0": { manifest: rel("0.4.0"), healthy: true }, "0.5.0": { manifest: rel("0.5.0"), healthy: true } } });
    expect(await runUpdate({ ...opts, to: "0.5.0", dryRun: true }, b.api, b.driver, () => {}, noSleep)).toEqual({ result: "stopped", reason: "dry run: nothing changed" });
    expect(b.calls).toEqual(["GET /v1/info", "GET /v1/update"]);
  });

  it("retags images in any registry", () => {
    expect(retag("ghcr.io/acme/workbench:0.3.0", "0.4.0")).toBe("ghcr.io/acme/workbench:0.4.0");
    expect(retag("localhost:5000/workbench", "0.4.0")).toBe("localhost:5000/workbench:0.4.0");
    expect(retag("europe-docker.pkg.dev/p/r/workbench@sha256:abc", "0.4.0")).toBe("europe-docker.pkg.dev/p/r/workbench:0.4.0");
  });
});
