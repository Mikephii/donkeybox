import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const schema = `
create table if not exists events (
  id integer primary key,
  at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source text not null,
  type text not null,
  summary text,
  actor text,
  payload text not null default '{}',
  run_id integer,
  dedupe_key text unique
);
create index if not exists events_run on events(run_id, id);
create index if not exists events_type on events(type, id);

create table if not exists runs (
  id integer primary key,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at text,
  ended_at text,
  updated_at text,
  trigger_event_id integer,
  parent_run_id integer,
  group_id text not null,
  rule_id text,
  title text not null,
  prompt text not null,
  mode text not null default 'interactive',
  status text not null default 'queued',
  session_id text not null,
  resume_session_id text,
  zellij_session text,
  workdir text,
  worktree text,
  repo text,
  goal text,
  goal_iterations integer not null default 0,
  model text,
  cost_usd real,
  result text,
  error text,
  actor text,
  session_deleted integer not null default 0
);
create index if not exists runs_status on runs(status);

create table if not exists requests (
  id integer primary key,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  group_id text not null,
  title text not null,
  body text not null default '',
  actions text not null,
  mode text not null,
  status text not null default 'open',
  origin_run_id integer,
  answer text,
  answered_at text,
  answered_by text,
  tool text
);
create index if not exists requests_status on requests(status, group_id);

create table if not exists deliveries (
  id integer primary key,
  at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source text,
  path text not null,
  status text not null,
  reason text,
  delivery_id text,
  event_id integer,
  event_type text,
  test integer not null default 0
);
create index if not exists deliveries_source on deliveries(source, id);
`;

/**
 * Numbered migrations. The database's `user_version` is its schema version. Each migration runs once,
 * in a transaction, in order. Migration 1 is the original schema (idempotent, so databases from before
 * versioning adopt it).
 *
 * Rollback rule: a migration only adds (tables, nullable or defaulted columns, indexes), so the
 * previous build keeps working on the new data. Code never relies on column order (`select *` into
 * positions, `insert` without a column list). A migration that drops or renames something is
 * breaking: it sets `floor` to its own version, says why in `breaking`, and ships one release after
 * the code that stopped using the old shape (`breaking.codeStoppedIn`). The compat floor stored in the
 * database is the oldest schema version that can still read it; a build below it refuses to start.
 */
export interface Migration {
  version: number;
  name: string;
  up: string;
  /** The compat floor after this migration. Only breaking migrations raise it. */
  floor?: number;
  breaking?: { reason: string; codeStoppedIn: string };
}

export const migrations: Migration[] = [
  { version: 1, name: "initial schema", up: schema + "create table if not exists zellij_tokens (email text primary key, token text not null, created_at text not null);" },
  {
    version: 2,
    name: "repo worktrees on runs",
    up: `alter table runs add column branch text;
         alter table runs add column worktree_removed integer not null default 0;`,
  },
  {
    version: 3,
    name: "terminals people open",
    up: `create table terminals (
           name text primary key,
           title text not null,
           cwd text not null,
           command text,
           created_by text not null,
           created_by_name text,
           created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           closed_at text,
           closed_by text
         );`,
  },
  {
    version: 4,
    name: "support access grants",
    up: `create table support_grants (
           id integer primary key,
           email text not null,
           role text not null default 'viewer',
           reason text not null,
           granted_by text not null,
           created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           expires_at text not null,
           revoked_at text,
           last_used_at text
         );`,
  },
];
export const SCHEMA_VERSION = migrations.at(-1)!.version;
/** The oldest schema version that can read a database this build has migrated. */
export const COMPAT_FLOOR = compatFloorOf(migrations);

export function compatFloorOf(list: Migration[]): number {
  return Math.max(1, ...list.map((m) => m.floor ?? 1));
}

export class NewerSchemaError extends Error {}

// Kept outside the numbered migrations so adding it changes no schema version: older builds ignore it.
const META = "create table if not exists workbench_meta (key text primary key, value text not null)";

/** The compat floor recorded in a database, or null when none is recorded (written before floors existed). */
export function storedFloor(db: DB): number | null {
  const t = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'workbench_meta'").get();
  if (!t) return null;
  const r = db.prepare("select value from workbench_meta where key = 'compat_floor'").get() as { value: string } | undefined;
  return r ? Number(r.value) : null;
}

export interface MigrateResult {
  from: number;
  to: number;
  floor: number;
  /** The data is from a newer build whose floor this build meets; nothing was migrated. */
  newer: boolean;
}

export function migrate(db: DB, log: (m: string) => void = () => {}, list: Migration[] = migrations): MigrateResult {
  const version = list.at(-1)!.version;
  const ourFloor = compatFloorOf(list);
  const from = db.pragma("user_version", { simple: true }) as number;
  if (from > version) {
    // Data from a newer build. Its floor says whether this build can still read it; without a recorded
    // floor (or with one above this build) it is refused rather than guessed at.
    const floor = storedFloor(db) ?? from;
    if (floor > version)
      throw new NewerSchemaError(
        `the database is schema ${from} and needs at least schema ${floor}, but this build knows up to ${version}; run a newer workbench image against this data, or restore a backup`,
      );
    log(`database is schema ${from} from a newer build; this build (schema ${version}) can read it because its compat floor is ${floor}`);
    return { from, to: from, floor, newer: true };
  }
  for (const m of list) {
    if (m.version <= from) continue;
    db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    })();
    log(`database migrated to ${m.version}: ${m.name}`);
  }
  db.exec(META);
  const floor = Math.max(storedFloor(db) ?? 1, ourFloor);
  db.prepare("insert into workbench_meta (key, value) values ('compat_floor', ?) on conflict(key) do update set value = excluded.value").run(String(floor));
  return { from, to: version, floor, newer: false };
}

export function openDb(path: string, o: { log?: (m: string) => void; migrations?: Migration[]; onMigrate?: (r: MigrateResult) => void } = {}): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const fresh = path === ":memory:" || !existsSync(path);
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true }) as number;
  // Keep a copy before changing an existing database's schema.
  const target = (o.migrations ?? migrations).at(-1)!.version;
  if (!fresh && version < target) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(path, `${path}.before-v${target}`);
  }
  try {
    const r = migrate(db, o.log, o.migrations);
    o.onMigrate?.(r);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
