// Runs inside the Acme box after a scene is set up: makes last night's scheduled run look like it ran
// at 02:00, and clears the setup's own noise (window and canvas changes) out of Activity.
import { createRequire } from "node:module";
const Database = createRequire("/opt/workbench/packages/app/package.json")("better-sqlite3");
const db = new Database("/data/internal/workbench.db");

// 02:00 today on the box's clock (TZ is set on the container).
const now = new Date();
const two = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0);
const iso = (d) => d.toISOString();
const at = (s) => iso(new Date(two.getTime() + s * 1000));

const nightly = db.prepare("select id from runs where title = 'Nightly housekeeping' order by id desc limit 1").get();
if (nightly) {
  const ev = db
    .prepare("insert into events (at, source, type, summary, payload) values (?, 'nightly', 'schedule.nightly', 'Nightly (0 2 * * *)', '{}')")
    .run(at(0));
  db.prepare("update runs set created_at = ?, started_at = ?, ended_at = ?, updated_at = ?, rule_id = 'nightly', trigger_event_id = ?, actor = null where id = ?")
    .run(at(0), at(1), at(19), at(19), ev.lastInsertRowid, nightly.id);
  db.prepare("update events set at = ? where run_id = ?").run(at(5), nightly.id);
}
db.prepare("delete from events where source = 'agent' and run_id is null").run();
// The box has been in use for a few days: Jira has posted to it, and Alice set up the estimates workflow.
const ago = (days, h = 10) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, h, 12));
db.prepare("insert into deliveries (at, source, path, status, delivery_id, event_type) values (?, 'jira', '/hooks/jira', 'accepted', 'jira-41', 'jira.issue.created')").run(ago(3));
db.prepare("insert into events (at, source, type, summary, actor) values (?, 'ui', 'config.changed', 'Alice saved workflow Estimates', 'alice@acme.dev')").run(ago(3, 11));
console.log("history set", nightly ? `(nightly run #${nightly.id} at ${at(0)})` : "(no nightly run)");
