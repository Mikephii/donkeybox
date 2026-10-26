import type { DB } from "./engine/db.ts";
import type { EventRow, RequestRow, RunRow } from "./engine/types.ts";

const list = (v: unknown): string[] =>
  typeof v === "string" && v.length ? v.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? (v as string[]) : [];

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Inclusive "to" date: YYYY-MM-DD becomes the start of the next day. */
function dayAfter(d: string): string {
  const t = Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d);
  return Number.isNaN(t) ? d : new Date(t + (d.length === 10 ? 86_400_000 : 0)).toISOString();
}

export function queries(db: DB) {
  return {
    runs(qs: { status?: string; group?: string; limit?: string; live?: string }) {
      const where: string[] = [];
      const vals: unknown[] = [];
      const statuses = list(qs.status);
      if (qs.live === "1") statuses.push("queued", "starting", "working", "blocked");
      if (statuses.length) (where.push(`r.status in (${placeholders(statuses.length)})`), vals.push(...statuses));
      const groups = list(qs.group);
      if (groups.length) (where.push(`r.group_id in (${placeholders(groups.length)})`), vals.push(...groups));
      const limit = Math.min(Number(qs.limit ?? 200), 1000);
      return db
        .prepare(
          `select r.*, e.summary as trigger_summary, e.type as trigger_type, e.source as trigger_source,
             (select count(*) from requests q where q.origin_run_id = r.id and q.status = 'open') as open_requests
           from runs r left join events e on e.id = r.trigger_event_id
           ${where.length ? "where " + where.join(" and ") : ""}
           order by case when r.status in ('queued','starting','working','blocked') then 0 else 1 end, r.id desc limit ?`,
        )
        .all(...vals, limit) as (RunRow & { trigger_summary: string | null })[];
    },
    event(id: number) {
      return db.prepare("select * from events where id = ?").get(id) as EventRow | undefined;
    },
    timeline(runId: number) {
      return db.prepare("select * from events where run_id = ? order by id").all(runId) as EventRow[];
    },
    childRuns(runId: number) {
      return db.prepare("select id, title, status from runs where parent_run_id = ? order by id").all(runId);
    },
    requestsForRun(runId: number) {
      return db.prepare("select * from requests where origin_run_id = ? order by id").all(runId) as RequestRow[];
    },
    requests(qs: { status?: string; group?: string; limit?: string }) {
      const where: string[] = [];
      const vals: unknown[] = [];
      const statuses = list(qs.status);
      if (statuses.length) (where.push(`status in (${placeholders(statuses.length)})`), vals.push(...statuses));
      const groups = list(qs.group);
      if (groups.length) (where.push(`group_id in (${placeholders(groups.length)})`), vals.push(...groups));
      const limit = Math.min(Number(qs.limit ?? 200), 1000);
      return db
        .prepare(`select * from requests ${where.length ? "where " + where.join(" and ") : ""} order by case status when 'open' then 0 else 1 end, id desc limit ?`)
        .all(...vals, limit) as RequestRow[];
    },
    openCounts() {
      const rows = db.prepare("select group_id, count(*) n from requests where status = 'open' group by group_id").all() as { group_id: string; n: number }[];
      return Object.fromEntries(rows.map((r) => [r.group_id, r.n]));
    },
    /** Activity: filters by type glob, source (prefix match for webhook:*), actor, run and dates; cursor paging by id. */
    events(qs: { limit?: string; type?: string; source?: string; actor?: string; run?: string; from?: string; to?: string; before?: string; hooks?: string }) {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (qs.type) (where.push("type like ?"), vals.push(qs.type.replace(/\*/g, "%")));
      if (qs.source) (where.push("(source = ? or source like ?)"), vals.push(qs.source, `${qs.source}:%`));
      else if (qs.hooks !== "1") where.push("source != 'hook'");
      if (qs.actor) (where.push("actor like ?"), vals.push(`%${qs.actor}%`));
      if (qs.run) (where.push("run_id = ?"), vals.push(Number(qs.run)));
      if (qs.from) (where.push("at >= ?"), vals.push(qs.from));
      if (qs.to) (where.push("at < ?"), vals.push(dayAfter(qs.to)));
      if (qs.before) (where.push("id < ?"), vals.push(Number(qs.before)));
      return db
        .prepare(`select * from events ${where.length ? "where " + where.join(" and ") : ""} order by id desc limit ?`)
        .all(...vals, Math.min(Number(qs.limit ?? 100), 1000)) as EventRow[];
    },
    eventFacets() {
      return {
        sources: (db.prepare("select distinct case when source like 'webhook:%' then source else source end s from events where source != 'hook' order by s").all() as { s: string }[]).map((r) => r.s),
        actors: (db.prepare("select distinct actor a from events where actor is not null order by a").all() as { a: string }[]).map((r) => r.a),
      };
    },

    /** Runs page: search title and prompt, filter, page, and total the cost of the whole filtered set. */
    searchRuns(qs: { q?: string; group?: string; status?: string; trigger?: string; from?: string; to?: string; page?: string; size?: string }) {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (qs.q) (where.push("(r.title like ? or r.prompt like ? or cast(r.id as text) = ?)"), vals.push(`%${qs.q}%`, `%${qs.q}%`, qs.q.replace(/^#/, "")));
      const groups = list(qs.group);
      if (groups.length) (where.push(`r.group_id in (${placeholders(groups.length)})`), vals.push(...groups));
      const statuses = list(qs.status);
      if (statuses.length) (where.push(`r.status in (${placeholders(statuses.length)})`), vals.push(...statuses));
      const triggers = list(qs.trigger);
      if (triggers.length) {
        const parts = triggers.map((t) => {
          if (t === "webhook") return "e.source like 'webhook:%'";
          if (t === "continuation") return "r.parent_run_id is not null";
          vals.push(t);
          return "e.source = ?";
        });
        where.push(`(${parts.join(" or ")})`);
      }
      if (qs.from) (where.push("r.created_at >= ?"), vals.push(qs.from));
      if (qs.to) (where.push("r.created_at < ?"), vals.push(dayAfter(qs.to)));
      const w = where.length ? "where " + where.join(" and ") : "";
      const size = Math.min(Math.max(Number(qs.size ?? 50), 1), 200);
      const page = Math.max(Number(qs.page ?? 1), 1);
      const totals = db.prepare(`select count(*) n, coalesce(sum(r.cost_usd), 0) cost from runs r left join events e on e.id = r.trigger_event_id ${w}`).get(...vals) as { n: number; cost: number };
      const rows = db
        .prepare(
          `select r.*, e.summary as trigger_summary, e.source as trigger_source,
             (select count(*) from requests q where q.origin_run_id = r.id and q.status = 'open') as open_requests
           from runs r left join events e on e.id = r.trigger_event_id ${w} order by r.id desc limit ? offset ?`,
        )
        .all(...vals, size, (page - 1) * size);
      return { rows, total: totals.n, cost: totals.cost, page, size, pages: Math.max(1, Math.ceil(totals.n / size)) };
    },

    deliveries(source: string | null, limit = 20) {
      return source
        ? db.prepare("select * from deliveries where source = ? order by id desc limit ?").all(source, limit)
        : db.prepare("select * from deliveries order by id desc limit ?").all(limit);
    },
    deliverySummary() {
      const rows = db.prepare("select source, count(*) n, sum(status = 'accepted') ok, sum(status = 'rejected') bad, max(at) last from deliveries group by source").all() as { source: string; n: number; ok: number; bad: number; last: string }[];
      return Object.fromEntries(rows.map((r) => [r.source, r]));
    },
    recordDelivery(d: { source: string | null; path: string; status: string; reason?: string; delivery_id?: string; event_id?: number; event_type?: string; test?: boolean }) {
      db.prepare("insert into deliveries (source, path, status, reason, delivery_id, event_id, event_type, test) values (?,?,?,?,?,?,?,?)")
        .run(d.source, d.path, d.status, d.reason ?? null, d.delivery_id ?? null, d.event_id ?? null, d.event_type ?? null, d.test ? 1 : 0);
    },
  };
}
