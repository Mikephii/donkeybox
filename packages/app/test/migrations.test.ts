import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { COMPAT_FLOOR, compatFloorOf, migrate, migrations, NewerSchemaError, openDb, SCHEMA_VERSION, storedFloor, type Migration } from "../src/engine/db.ts";
import { compareVersions, releaseManifest } from "../src/release.ts";

const ROOT = join(import.meta.dirname, "../../..");
const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// SQL that removes or renames something: the previous build would break on it.
const DESTRUCTIVE = /\b(drop\s+(table|column|index|view|trigger)|rename\s+(to|column)|alter\s+table\s+\w+\s+rename)\b/i;

/** Rules every migration in the list must follow; returns what breaks them. */
function checkMigrations(list: Migration[], version: string): string[] {
  const problems: string[] = [];
  let floor = 1;
  list.forEach((m, i) => {
    if (m.version !== i + 1) problems.push(`migration ${m.name}: versions must count up from 1 without gaps`);
    const f = m.floor ?? 1;
    if (f > floor && !m.breaking) problems.push(`migration ${m.version} raises the compat floor to ${f} without saying why in "breaking"`);
    if (m.breaking && f !== m.version) problems.push(`migration ${m.version} is breaking, so its floor must be its own version (${m.version})`);
    if (DESTRUCTIVE.test(m.up) && !m.breaking) problems.push(`migration ${m.version} drops or renames something but is not marked breaking`);
    if (m.breaking && compareVersions(m.breaking.codeStoppedIn, version) >= 0)
      problems.push(`migration ${m.version} is breaking; it ships at least one release after ${m.breaking.codeStoppedIn}, the release whose code stopped using the old shape`);
    if (f < floor) problems.push(`migration ${m.version} lowers the compat floor`);
    floor = Math.max(floor, f);
  });
  return problems;
}

describe("migrations and the compat floor", () => {
  it("the real migration list follows the rules", () => {
    expect(checkMigrations(migrations, pkgVersion)).toEqual([]);
    expect(COMPAT_FLOOR).toBe(compatFloorOf(migrations));
    expect(releaseManifest("9.9.9")).toMatchObject({ version: "9.9.9", schemaVersion: SCHEMA_VERSION, compatFloor: COMPAT_FLOOR });
  });

  it("the rule check catches a floor raised without a breaking marker, and destructive SQL", () => {
    const base = migrations.slice();
    expect(checkMigrations([...base, { version: base.length + 1, name: "x", up: "alter table runs add column x text", floor: base.length + 1 }], "9.0.0")).toEqual([
      `migration ${base.length + 1} raises the compat floor to ${base.length + 1} without saying why in "breaking"`,
    ]);
    expect(checkMigrations([...base, { version: base.length + 1, name: "x", up: "alter table runs drop column repo" }], "9.0.0")).toEqual([
      `migration ${base.length + 1} drops or renames something but is not marked breaking`,
    ]);
    expect(checkMigrations([...base, { version: base.length + 1, name: "x", up: "alter table runs rename column repo to place" }], "9.0.0")[0]).toMatch(/not marked breaking/);
    const ok: Migration = { version: base.length + 1, name: "x", up: "alter table runs drop column repo", floor: base.length + 1, breaking: { reason: "runs no longer read repo", codeStoppedIn: "8.0.0" } };
    expect(checkMigrations([...base, ok], "9.0.0")).toEqual([]);
    // Shipped in the same release as the code that stopped using it: too early.
    expect(checkMigrations([...base, ok], "8.0.0")[0]).toMatch(/at least one release after 8.0.0/);
  });

  it("records the floor beside user_version, outside the numbered migrations", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(storedFloor(db)).toBe(COMPAT_FLOOR);
  });

  it("an older build runs on newer data whose floor it meets, and refuses data whose floor it does not", () => {
    const newer: Migration[] = [...migrations, { version: SCHEMA_VERSION + 1, name: "additive", up: "create table extra (id integer primary key)" }];
    const path = join(mkdtempSync(join(tmpdir(), "wb-mig-")), "w.db");
    openDb(path, { migrations: newer }).close();
    // This build (the older one) on data from the newer build: runs, migrates nothing, keeps the version.
    const logs: string[] = [];
    let state: any;
    const db = openDb(path, { log: (m) => logs.push(m), onMigrate: (r) => (state = r) });
    expect(state).toMatchObject({ from: SCHEMA_VERSION + 1, to: SCHEMA_VERSION + 1, newer: true, floor: COMPAT_FLOOR });
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION + 1);
    expect(logs[0]).toMatch(/newer build/);
    db.close();

    // A breaking migration raises the floor past this build: refused with a clear message.
    const breaking: Migration[] = [...newer, { version: SCHEMA_VERSION + 2, name: "drop", up: "drop table extra", floor: SCHEMA_VERSION + 2, breaking: { reason: "extra moved", codeStoppedIn: "0.0.1" } }];
    openDb(path, { migrations: breaking }).close();
    expect(() => openDb(path)).toThrow(NewerSchemaError);
    expect(() => openDb(path)).toThrow(`needs at least schema ${SCHEMA_VERSION + 2}`);
    // The build that wrote it, and a build between, still open it.
    openDb(path, { migrations: breaking }).close();
  });

  it("data from a newer build with no recorded floor (a build before floors) is refused", () => {
    const raw = new Database(":memory:");
    raw.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(raw)).toThrow(NewerSchemaError);
  });

  it("an existing database is copied before it is migrated", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-mig-"));
    const path = join(dir, "w.db");
    openDb(path, { migrations: migrations.slice(0, 2) }).close();
    openDb(path).close();
    const copy = new Database(`${path}.before-v${SCHEMA_VERSION}`, { readonly: true });
    expect(copy.pragma("user_version", { simple: true })).toBe(2);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.4.0-rc.1", "0.4.0")).toBe(-1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });
});
