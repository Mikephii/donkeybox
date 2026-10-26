import type { DB } from "../engine/db.ts";

/**
 * Support access: a host may let one of its people into the box for a limited time, for example to
 * help with a broken workflow. Off by default; each grant has an email, a role, a reason and an
 * expiry, and turning it on, using it and revoking it all show in Activity.
 */
export interface SupportGrant {
  id: number;
  email: string;
  role: "admin" | "member" | "viewer";
  reason: string;
  granted_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export class SupportAccess {
  private db: DB;
  /** Called when a grant is created, used for the first time in an hour, or revoked. */
  onEvent: (type: "support.enabled" | "support.used" | "support.disabled", g: SupportGrant) => void = () => {};
  constructor(db: DB) {
    this.db = db;
  }
  list(): SupportGrant[] {
    return this.db.prepare("select * from support_grants order by id desc limit 50").all() as SupportGrant[];
  }
  active(email: string): SupportGrant | null {
    const now = new Date().toISOString();
    return (this.db.prepare("select * from support_grants where lower(email) = lower(?) and revoked_at is null and expires_at > ? order by id desc limit 1").get(email, now) as SupportGrant | undefined) ?? null;
  }
  grant(input: { email: string; role?: string; minutes?: number; reason?: string }, by: string): SupportGrant {
    const email = String(input.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("email is required");
    const role = (["admin", "member", "viewer"].includes(String(input.role)) ? input.role : "viewer") as SupportGrant["role"];
    const minutes = Math.min(Math.max(Number(input.minutes ?? 60), 5), 24 * 60);
    const reason = String(input.reason ?? "").trim();
    if (!reason) throw new Error("a reason is required; it is shown in Activity");
    const expires = new Date(Date.now() + minutes * 60_000).toISOString();
    const id = Number(this.db.prepare("insert into support_grants (email, role, reason, granted_by, expires_at) values (?,?,?,?,?)").run(email, role, reason, by, expires).lastInsertRowid);
    const g = this.db.prepare("select * from support_grants where id = ?").get(id) as SupportGrant;
    this.onEvent("support.enabled", g);
    return g;
  }
  revoke(id: number): SupportGrant {
    this.db.prepare("update support_grants set revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ? and revoked_at is null").run(id);
    const g = this.db.prepare("select * from support_grants where id = ?").get(id) as SupportGrant | undefined;
    if (!g) throw new Error(`no grant ${id}`);
    this.onEvent("support.disabled", g);
    return g;
  }
  /** Marks a grant used; reports it to Activity at most once an hour per grant. */
  used(g: SupportGrant) {
    const now = Date.now();
    if (!g.last_used_at || now - Date.parse(g.last_used_at) > 3600_000) {
      this.db.prepare("update support_grants set last_used_at = ? where id = ?").run(new Date(now).toISOString(), g.id);
      this.onEvent("support.used", g);
    }
  }
}
