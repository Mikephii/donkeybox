import Fastify, { type FastifyReply } from "fastify";
import { ConfigStore, sourceKind } from "./engine/config.ts";
import { deliveryId, findSourceByPath, normalize, safeEqual, verify } from "./engine/sources.ts";
import { createSecretStore } from "./lib/secrets.ts";
import { env, localApiUrl, paths } from "./env.ts";

/**
 * The public webhook door's only upstream. Generic over config.sources:
 * find the source by path, verify, normalize, hand the event to the app over loopback.
 * It never opens the database, so a bug here cannot touch approvals. Every delivery,
 * accepted or not, is recorded through the app for the Sources page.
 */
const config = new ConfigStore(env.configPath);
// Read-only use of the same store the app writes: store first, then the environment.
const secrets = createSecretStore({ backend: env.secretsBackend, path: paths.secrets, gcpProject: env.gcpProject, gcpPrefix: env.gcpSecretPrefix });
await secrets.load().catch((e) => console.error(`secrets: could not load the ${env.secretsBackend} store: ${e.message}`));
const app = Fastify({ logger: { level: "info" }, bodyLimit: 2 * 1024 * 1024, forceCloseConnections: true });

app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

function record(d: { source: string | null; path: string; status: string; reason?: string; delivery_id?: string; event_id?: number; event_type?: string; test?: boolean }) {
  void fetch(`${localApiUrl}/deliveries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d), signal: AbortSignal.timeout(3000) }).catch(() => {});
}

/**
 * External scheduler (settings.scheduler.mode = external): the host or control plane calls this at each
 * schedule's times instead of the box keeping its own cron, so the box may sleep in between. The call
 * also wakes a stopped box, since it arrives at the public hooks door.
 */
app.post("/hooks/_schedule/:source", async (req, reply: FastifyReply) => {
  const id = (req.params as { source: string }).source;
  const st = config.get().settings.scheduler;
  const path = `/hooks/_schedule/${id}`;
  if (st.mode !== "external") return reply.code(404).send({ error: "this box runs its own schedules (Settings › Schedules)" });
  const want = secrets.resolve(st.secret);
  const got = req.headers["x-workbench-schedule-secret"];
  if (!want || typeof got !== "string" || !safeEqual(got, want)) {
    record({ source: id, path, status: "rejected", reason: "bad or missing X-Workbench-Schedule-Secret" });
    return reply.code(401).send({ error: "unauthorized" });
  }
  const s = config.get().sources[id];
  if (!s || sourceKind(s) !== "schedule") {
    record({ source: null, path, status: "rejected", reason: `no schedule source ${id}` });
    return reply.code(404).send({ error: "no such schedule" });
  }
  // One event per scheduled time even if the scheduler retries: it may send X-Scheduled-For.
  const at = String(req.headers["x-scheduled-for"] ?? new Date().toISOString().slice(0, 16));
  const res = await fetch(`${localApiUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "schedule", type: s.type, summary: `${s.title ?? id} (${s.schedule}, external)`, payload: s.payload ?? {}, dedupe_key: `schedule:${id}:${at}` }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) return reply.code(503).send({ error: "app unavailable" });
  const out = (await res.json()) as { event_id?: number };
  record({ source: id, path, status: "accepted", event_id: out.event_id, event_type: s.type });
  return reply.code(202).send(out);
});

app.post("/hooks/*", async (req, reply: FastifyReply) => {
  const path = req.url.split("?")[0]!;
  const found = findSourceByPath(config.get().sources, req.url);
  // Never log or store a url-token: record the source's own path instead of the requested one.
  const test = req.headers["x-wb-test"] === "1";
  if (!found) {
    record({ source: null, path, status: "rejected", reason: "no source with this path" });
    return reply.code(404).send({ error: "no such hook" });
  }
  const [sourceId, source] = found;
  const safePath = source.path ?? path;
  const rawBody = (req.body as Buffer) ?? Buffer.alloc(0);
  const inbound = { headers: req.headers, rawBody, body: undefined as unknown, path };
  const id = deliveryId(source, inbound);
  const bad = verify(source, inbound, secrets.resolve);
  if (bad) {
    req.log.warn({ sourceId, reason: bad }, "rejected webhook");
    record({ source: sourceId, path: safePath, status: "rejected", reason: bad, delivery_id: id, test });
    return reply.code(401).send({ error: "unauthorized" });
  }
  try {
    inbound.body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    record({ source: sourceId, path: safePath, status: "rejected", reason: "body is not JSON", delivery_id: id, test });
    return reply.code(400).send({ error: "body must be JSON" });
  }
  const ev = normalize(source, inbound);
  if (!ev && sourceKind(source) === "generic") {
    record({ source: sourceId, path: safePath, status: "rejected", reason: "generic sources take {type, summary, payload}; type is missing or not like a.b-c", delivery_id: id, test });
    return reply.code(422).send({ error: "body must be {type, summary?, payload?, actor?}" });
  }
  if (!ev) {
    record({ source: sourceId, path: safePath, status: "ignored", reason: "adapter ignores this event (e.g. ping)", delivery_id: id, test });
    return reply.code(202).send({ ignored: true });
  }
  // Respond fast; the app does the work. GitHub gives up after 10 seconds.
  const res = await fetch(`${localApiUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: `webhook:${sourceId}`, ...ev, dedupe_key: id ? `${sourceId}:${id}` : undefined, test }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!res?.ok) {
    record({ source: sourceId, path: safePath, status: "failed", reason: "app unavailable", delivery_id: id, event_type: ev.type, test });
    return reply.code(502).send({ error: "app unavailable" });
  }
  const out = (await res.json()) as { event_id: number; duplicate: boolean; runs: number[] };
  record({ source: sourceId, path: safePath, status: out.duplicate ? "duplicate" : "accepted", delivery_id: id, event_id: out.event_id, event_type: ev.type, test, reason: out.runs.length ? `started run ${out.runs.join(", ")}` : test ? "test: rules not run" : "no rule matched" });
  return reply.code(202).send(out);
});
app.all("/*", async (_req, reply) => reply.code(404).send({ error: "not found" }));

await app.listen({ host: process.env.WB_HOOKS_HOST ?? "127.0.0.1", port: env.hooksPort });
