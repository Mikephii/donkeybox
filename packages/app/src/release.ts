// What a release is, for the update routine: its version, the schema it writes, the oldest schema
// that can read its data and the oldest release that may upgrade straight to it.
//   node packages/app/src/release.ts            prints this build's manifest (pnpm release writes it out)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPAT_FLOOR, SCHEMA_VERSION } from "./engine/db.ts";

/**
 * The oldest release that can upgrade straight to this one. Raise it when a release drops support for
 * something older releases left behind (a config shape, a data layout); boxes on older releases then
 * update to an intermediate release first. 0.3.0 is the first release with the one-volume image.
 */
export const MIN_UPGRADE_FROM = "0.3.0";

/**
 * What this build can do for the update routine. `wb update` reads these from /v1/info, so a box on an
 * older release that lacks one is handled by what it can do rather than by version numbers.
 *   drain         POST /v1/drain and /v1/undrain
 *   backup        POST /v1/backup
 *   update-record POST /v1/update/begin and /finish
 *   self-restore  restores its own backup on start when rolled back onto data it cannot read
 *   compat-floor  runs on newer data whose compat floor it meets
 *   schedules     GET /v1/schedules lists schedule sources, for a host running them externally
 */
export const CAPABILITIES = ["drain", "backup", "update-record", "self-restore", "compat-floor", "schedules"] as const;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function productVersion(): string {
  if (process.env.WB_VERSION && process.env.WB_VERSION !== "dev") return process.env.WB_VERSION;
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  } catch {
    return "dev";
  }
}

export interface ReleaseManifest {
  version: string;
  schemaVersion: number;
  compatFloor: number;
  minUpgradeFrom: string;
  capabilities: string[];
}

export function releaseManifest(version = productVersion()): ReleaseManifest {
  return { version, schemaVersion: SCHEMA_VERSION, compatFloor: COMPAT_FLOOR, minUpgradeFrom: MIN_UPGRADE_FROM, capabilities: [...CAPABILITIES] };
}

/** Compares dotted versions numerically (0.10.0 > 0.9.2); a pre-release suffix sorts before its release. */
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

export const isReleaseVersion = (v: string) => /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v);

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(releaseManifest(process.argv[2]), null, 2));
