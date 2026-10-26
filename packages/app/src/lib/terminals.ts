import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ConfigStore } from "../engine/config.ts";
import type { DB } from "../engine/db.ts";
import { shellLayout } from "./sessions.ts";
import type { Zellij } from "./zellij.ts";

/**
 * Terminals people open from the UI or the admin tools: a Zellij session in a folder (the workspace,
 * or any folder), optionally running a first command, with WB_ACTOR set so `wb` and commits
 * know who is typing. Standing sessions come from config; run sessions belong to runs.
 */
export interface TerminalRow {
  name: string;
  title: string;
  cwd: string;
  command: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  closed_at: string | null;
}

export class TerminalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18) || "term";
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export class Terminals {
  private db: DB;
  private zellij: Zellij;
  private config: ConfigStore;
  private o: { layoutsDir: string; workspace: string };
  constructor(db: DB, zellij: Zellij, config: ConfigStore, o: { layoutsDir: string; workspace: string }) {
    this.db = db;
    this.zellij = zellij;
    this.config = config;
    this.o = o;
  }

  open(): TerminalRow[] {
    return this.db.prepare("select * from terminals where closed_at is null order by created_at").all() as TerminalRow[];
  }
  get(name: string) {
    return this.db.prepare("select * from terminals where name = ?").get(name) as TerminalRow | undefined;
  }

  /** Every live session, grouped the way the Terminal window's picker shows them. */
  async grouped(me: string) {
    const live = await this.zellij.list();
    const alive = new Set(live.filter((s) => !s.exited).map((s) => s.name));
    const c = this.config.get();
    const standing = c.terminals.map((t) => ({ name: t.name, title: t.title ?? t.name, description: t.description ?? null, cwd: t.cwd, layout: t.layout, alive: alive.has(t.name) }));
    const people = this.open()
      .filter((t) => alive.has(t.name))
      .map((t) => ({ name: t.name, title: t.title, cwd: t.cwd, command: t.command, createdBy: t.created_by, createdByName: t.created_by_name, createdAt: t.created_at }));
    // A session we did not make (someone ran `zellij attach -c` in a shell) still shows, without an owner.
    const known = new Set([...standing.map((s) => s.name), ...people.map((p) => p.name)]);
    const runRows = this.db.prepare("select id, title, status, zellij_session from runs where zellij_session is not null and session_deleted = 0").all() as { id: number; title: string; status: string; zellij_session: string }[];
    const runs = runRows.filter((r) => alive.has(r.zellij_session)).map((r) => ({ name: r.zellij_session, title: r.title, runId: r.id, status: r.status }));
    for (const r of runs) known.add(r.name);
    const other = [...alive].filter((n) => !known.has(n)).map((n) => ({ name: n, title: n, cwd: null, command: null, createdBy: null, createdByName: null, createdAt: null }));
    return {
      standing,
      yours: people.filter((p) => p.createdBy === me),
      others: [...people.filter((p) => p.createdBy !== me), ...other],
      runs: runs.sort((a, b) => b.runId - a.runId),
      limit: c.settings.limits.maxTerminals,
      used: people.length,
    };
  }

  /** Checks a starting folder: "workspace", a folder relative to the workspace, or an existing absolute folder. */
  folder(cwd: string): string {
    if (!cwd || cwd === "workspace") return this.o.workspace;
    const p = isAbsolute(cwd) ? cwd : join(this.o.workspace, cwd);
    if (!existsSync(p) || !statSync(p).isDirectory()) throw new TerminalError(422, `${cwd} is not a folder on the box`);
    return p;
  }

  async create(input: { title?: string; cwd?: string; command?: string }, actor: { email: string; name: string }) {
    const title = (input.title ?? "").trim() || "Terminal";
    if (title.length > 60) throw new TerminalError(422, "names are up to 60 characters");
    const max = this.config.get().settings.limits.maxTerminals;
    const live = new Set((await this.zellij.list()).filter((s) => !s.exited).map((s) => s.name));
    const openCount = this.open().filter((t) => live.has(t.name)).length;
    if (openCount >= max) throw new TerminalError(429, `the box allows ${max} open terminals (Settings › Limits); close one first`);
    const cwd = input.cwd || "workspace";
    const dir = this.folder(cwd);
    const name = `t-${slug(title)}-${randomBytes(2).toString("hex")}`;
    // WB_ACTOR tells `wb` and the admin tools who is at the keyboard.
    const actorLine = `export WB_ACTOR=${shq(`${actor.name} <${actor.email}>`)}`;
    const cmd = input.command?.trim() ? `${actorLine}; ${input.command.trim()}` : actorLine;
    mkdirSync(this.o.layoutsDir, { recursive: true });
    const path = join(this.o.layoutsDir, `${name}.kdl`);
    writeFileSync(path, shellLayout(dir, title, cmd));
    await this.zellij.createWithLayout(name, path, title);
    this.db
      .prepare("insert into terminals (name, title, cwd, command, created_by, created_by_name) values (?,?,?,?,?,?)")
      .run(name, title, cwd, input.command?.trim() || null, actor.email, actor.name);
    return this.get(name)!;
  }

  rename(name: string, title: string) {
    const t = this.get(name);
    if (!t || t.closed_at) throw new TerminalError(404, `no open terminal ${name}`);
    const clean = title.trim();
    if (!clean || clean.length > 60) throw new TerminalError(422, "names are 1 to 60 characters");
    this.db.prepare("update terminals set title = ? where name = ?").run(clean, name);
    return this.get(name)!;
  }

  /** Ends the session. Standing and run sessions are not closed here. */
  async close(name: string, by: string) {
    const t = this.get(name);
    if (!t || t.closed_at) throw new TerminalError(404, `no open terminal ${name}`);
    await this.zellij.delete(name);
    this.db.prepare("update terminals set closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), closed_by = ? where name = ?").run(by, name);
    return { closed: name };
  }
}
