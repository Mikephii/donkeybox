import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import type { DB } from "../engine/db.ts";
import type { Zellij } from "./zellij.ts";

/**
 * Logs a browser into Zellij's web client on the user's behalf, with a Zellij
 * token named after their email. Zellij 0.45's CLI cannot name a token at
 * creation (--create-token is exclusive), so we create one and rename it with
 * the same statement Zellij's own rename_token runs.
 */
export class TermLogin {
  db: DB;
  zellij: Zellij;
  tokensDb: string;
  zellijUrl: string;
  constructor(db: DB, zellij: Zellij, tokensDb: string, zellijUrl: string) {
    this.db = db;
    this.zellij = zellij;
    this.tokensDb = tokensDb;
    this.zellijUrl = zellijUrl;
  }

  /** True if the browser's session_token cookie is still accepted by Zellij. */
  async cookieValid(cookie: string | undefined): Promise<boolean> {
    if (!cookie || !/session_token=/.test(cookie)) return false;
    try {
      const r = await fetch(`${this.zellijUrl}/session-list`, { headers: { cookie } });
      return r.ok;
    } catch {
      return false;
    }
  }

  private rename(from: string, to: string) {
    if (!existsSync(this.tokensDb)) throw new Error(`zellij token db not found at ${this.tokensDb}`);
    const z = new Database(this.tokensDb);
    try {
      z.pragma("busy_timeout = 5000");
      z.prepare("update tokens set name = ? where name = ?").run(to, from);
    } finally {
      z.close();
    }
  }

  /** Viewers get a read-only token, named "<email> (watch)", so terminals are watch-only for them. */
  static tokenName(email: string, readOnly: boolean) {
    return readOnly ? `${email} (watch)` : email;
  }

  private making = new Map<string, Promise<string>>();

  /** One person opening several terminals at once shares one token; two makers would both rename to the same name. */
  tokenFor(email: string, readOnly = false): Promise<string> {
    const key = TermLogin.tokenName(email, readOnly);
    const busy = this.making.get(key);
    if (busy) return busy;
    const p = this.makeToken(key, readOnly).finally(() => this.making.delete(key));
    this.making.set(key, p);
    return p;
  }

  private async makeToken(key: string, readOnly: boolean): Promise<string> {
    const names = await this.zellij.listTokens();
    const row = this.db.prepare("select token from zellij_tokens where email = ?").get(key) as { token: string } | undefined;
    if (row && names.includes(key)) return row.token;
    if (names.includes(key)) await this.zellij.revokeToken(key);
    const { name, token } = await this.zellij.createToken(readOnly);
    this.rename(name, key);
    this.db
      .prepare("insert into zellij_tokens (email, token, created_at) values (?,?,?) on conflict(email) do update set token = excluded.token, created_at = excluded.created_at")
      .run(key, token, new Date().toISOString());
    return token;
  }

  /** Returns the Set-Cookie header Zellij issued, to be forwarded to the browser. */
  async login(email: string, readOnly = false): Promise<string> {
    const key = TermLogin.tokenName(email, readOnly);
    const attempt = async () => {
      const token = await this.tokenFor(email, readOnly);
      return fetch(`${this.zellijUrl}/command/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth_token: token, remember_me: true }),
      });
    };
    let r = await attempt();
    if (r.status === 401 || r.status === 403) {
      this.db.prepare("delete from zellij_tokens where email = ?").run(key);
      r = await attempt();
    }
    const setCookie = r.headers.get("set-cookie");
    if (!r.ok || !setCookie) throw new Error(`zellij login failed (${r.status})`);
    return setCookie;
  }

  /**
   * Revokes terminal tokens that should no longer work: people no longer let in, and typing tokens of
   * people who are now viewers. keep(email, readOnly) says whether a token may stay.
   */
  async reconcile(keep: (email: string, readOnly: boolean) => boolean): Promise<string[]> {
    const revoked: string[] = [];
    for (const name of await this.zellij.listTokens()) {
      const readOnly = / \(watch\)$/.test(name);
      if (name.includes("@") && !keep(name.replace(/ \(watch\)$/, ""), readOnly)) {
        await this.zellij.revokeToken(name);
        this.db.prepare("delete from zellij_tokens where email = ?").run(name);
        revoked.push(name);
      }
    }
    return revoked;
  }
}
