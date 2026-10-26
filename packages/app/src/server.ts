import { Cron } from "croner";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { createApp } from "./app.ts";
import { schemaText } from "./schema.ts";
import { ConfigStore, configSchema, parseConfig } from "./engine/config.ts";
import { COMPAT_FLOOR, NewerSchemaError, openDb, SCHEMA_VERSION, type MigrateResult } from "./engine/db.ts";
import { Maintenance, noteBoot, selfRestore } from "./lib/maintenance.ts";
import { releaseManifest } from "./release.ts";
import { Engine } from "./engine/engine.ts";
import { AgentLauncher } from "./engine/launcher.ts";
import { ACTIVE, type RunRow } from "./engine/types.ts";
import { createAuth } from "./lib/auth.ts";
import { DeployKey } from "./lib/keys.ts";
import { SupervisorBackend } from "./lib/services.ts";
import { ensureStandingSessions } from "./lib/sessions.ts";
import { YjsNotifier } from "./lib/signals.ts";
import { trustFolder } from "./lib/claude-trust.ts";
import { ActivityClock } from "./lib/activity.ts";
import { detectClaude } from "./lib/setup.ts";
import { spawnSync } from "node:child_process";
import { Admin } from "./lib/admin.ts";
import { SupportAccess } from "./lib/support.ts";
import { managementApp } from "./management.ts";
import { Terminals } from "./lib/terminals.ts";
import { createSecretStore } from "./lib/secrets.ts";
import { SkillStore } from "./lib/skills.ts";
import { TermLogin } from "./lib/term-login.ts";
import { createWorkspaceFromTemplate, Workspace } from "./lib/workspace.ts";
import { Zellij } from "./lib/zellij.ts";
import { bin, DATA_DIR, env, localApiUrl, paths, WORKSPACE_DIR } from "./env.ts";
import { queries } from "./queries.ts";

mkdirSync(DATA_DIR, { recursive: true });
// The data folder is the workbench's own: nobody needs to look in here, and editing it by hand can
// break the box. Everything in it is reachable from the app, `wb` or the Settings page.
writeFileSync(
  join(DATA_DIR, "README.txt"),
  "Managed by the workbench. Do not edit or delete anything here.\n\nThis folder holds the box's database, canvases, run folders, secrets, keys and logs.\nUse the app, `wb` or Settings instead. The box's config is in the workspace folder, and\nyour own code can live anywhere else on the box.\n",
);
if (createWorkspaceFromTemplate(WORKSPACE_DIR, env.templateDir)) console.log(`created workspace at ${WORKSPACE_DIR} from the template`);

// A database from an earlier start means this is a restart (possibly after sleep), not a first boot.
const firstBoot = !existsSync(paths.db);
let db: ReturnType<typeof openDb>;
let dbState: MigrateResult | null = null;
const openTheDb = () => openDb(paths.db, { log: (m) => console.log(m), onMigrate: (r) => (dbState = r) });
try {
  try {
    db = openTheDb();
  } catch (e) {
    // Put back after a failed update onto data it cannot read: restore the backup taken before it.
    if (!(e instanceof NewerSchemaError)) throw e;
    const r = selfRestore({
      dataDir: DATA_DIR, dbPath: paths.db, workspaceDir: WORKSPACE_DIR, version: env.version, schemaVersion: SCHEMA_VERSION,
      secretsPath: env.secretsBackend === "file" ? paths.secrets : null,
      configLoads: (p) => {
        try {
          return parseConfig(JSON.parse(readFileSync(p, "utf8"))).ok;
        } catch {
          return false;
        }
      },
      log: (m) => console.log(m),
    });
    if (!r) throw e;
    db = openTheDb();
  }
} catch (e) {
  console.error(`refusing to start: ${(e as Error).message}`);
  process.exit(3);
}
noteBoot(DATA_DIR, env.version, (m) => console.log(m));
const secretStore = createSecretStore({ backend: env.secretsBackend, path: paths.secrets, gcpProject: env.gcpProject, gcpPrefix: env.gcpSecretPrefix, authMode: env.authMode });
await secretStore.load().catch((e) => console.error(`secrets: could not load the ${env.secretsBackend} store: ${e.message}`));
const deployKey = new DeployKey(paths.keys);
const notifier = new YjsNotifier(`ws://127.0.0.1:${env.yjsPort}`);
const workspace = new Workspace(WORKSPACE_DIR, {
  sshCommand: () => (deployKey.exists() ? deployKey.sshCommand() : undefined),
  onChange: () => notifier.signal("config", { workspace: true }),
});
const config = new ConfigStore(env.configPath, {
  onWrite: (info) => void workspace.commit(info, [env.configPath, ...(info.paths ?? [])]),
});
const skillsDir = () => resolve(WORKSPACE_DIR, config.get().settings.skillsDir);
const skills = new SkillStore(skillsDir);
skills.onWrite = (info) => void workspace.commit({ message: info.message, author: info.author }, [info.path]);

// Every box has a stable id and a name (Settings); assign the id once.
if (!config.errors() && !config.get().settings.box.id) {
  config.update((raw) => ({ ...raw, settings: { ...(raw.settings ?? {}), box: { ...(raw.settings?.box ?? {}), id: `box_${randomBytes(6).toString("hex")}` } } }), { message: "Assign this box an id" });
}

// A deployment (Terraform, compose, the hosted control plane) knows the public addresses; it hands
// them over once and they become ordinary settings a person can change afterwards.
// WB_SEED_SETTINGS (JSON) fills in any settings the workspace has not set yet: doors, the proxy's
// networks, the workspace remote. Values already in config.json always win.
if (!config.errors()) {
  const s = config.get().settings;
  let seed: Record<string, unknown> = {};
  try {
    seed = env.seedSettings ? JSON.parse(env.seedSettings) : {};
  } catch {
    console.error("WB_SEED_SETTINGS is not valid JSON; ignored");
  }
  if (!s.publicHooksUrl && env.seedPublicHooksUrl) seed.publicHooksUrl = env.seedPublicHooksUrl.replace(/\/$/, "");
  if (!s.publicAppUrl && env.seedPublicAppUrl) seed.publicAppUrl = env.seedPublicAppUrl.replace(/\/$/, "");
  const fill = (have: Record<string, any>, add: Record<string, any>): Record<string, any> => {
    const out = { ...have };
    for (const [k, v] of Object.entries(add))
      if (v === null || v === undefined) continue;
      else if (typeof v === "object" && !Array.isArray(v)) out[k] = fill(have[k] ?? {}, v as Record<string, any>);
      else if (have[k] === undefined || (Array.isArray(have[k]) && !have[k].length)) out[k] = v;
    return out;
  };
  const raw = (config.raw().settings ?? {}) as Record<string, any>;
  const next = fill(raw, seed);
  if (JSON.stringify(next) !== JSON.stringify(raw)) {
    const r = config.update((c) => ({ ...c, settings: next }), { message: "Apply settings from the deployment" });
    if (!r.ok) console.error("could not apply settings from the deployment:", r.errors.join("; "));
  }
}

// Editors validate config.json against this; kept in the workspace so clones on laptops get it too.
function publishSchema() {
  const file = join(WORKSPACE_DIR, ".workbench/config.schema.json");
  const text = schemaText();
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;
  mkdirSync(join(WORKSPACE_DIR, ".workbench"), { recursive: true });
  writeFileSync(file, text);
  workspace.commit({ message: "Update config schema" }, [file]);
}
publishSchema();

const zellij = new Zellij(env.zellij, env.zellijConfig, env.zellijSocketDir);
const launcher = new AgentLauncher(zellij, config, {
  runsDir: paths.runs,
  workDir: paths.work,
  skillsDir: skillsDir,
  workspaceDir: WORKSPACE_DIR,
  hooksDir: paths.hooksDir,
  mcpServer: paths.mcp,
  localApiUrl,
  claudeBin: env.claude,
  extraPath: [paths.workspaceBin, paths.cliBin, paths.toolsBin],
  adminTokenFile: paths.adminToken,
  secretsFile: env.secretsBackend === "file" ? paths.secrets : undefined,
  keysDir: paths.keys,
  expandSecrets: (v) => secretStore.expand(v),
  dataDir: DATA_DIR,
});
launcher.trust = (folder) => trustFolder(folder);
const activity = new ActivityClock();
/** Disk use of the data volume, as a percentage. */
function diskPercent(): number | null {
  try {
    const s = statfsSync(DATA_DIR);
    return Math.round((1 - s.bavail / s.blocks) * 1000) / 10;
  } catch {
    return null;
  }
}
const liveRunCount = () => (db.prepare("select count(*) n from runs where status in ('starting','working','blocked')").get() as { n: number }).n;
const maintenance = new Maintenance({
  db, dataDir: DATA_DIR, workspaceDir: WORKSPACE_DIR,
  secretsPath: env.secretsBackend === "file" ? paths.secrets : null,
  manifest: releaseManifest(env.version),
  box: () => config.get().settings.box.id ?? null,
  liveRuns: liveRunCount,
  queuedRuns: () => (db.prepare("select count(*) n from runs where status = 'queued'").get() as { n: number }).n,
  onChange: () => {
    notifier.signal("runs", { maintenance: true });
    // Drain over: start what queued up meanwhile.
    if (!maintenance.draining) engine.launchQueued();
  },
  log: (m) => console.log(m),
});
const engine = new Engine({
  db, config, launcher, notifier, goalMaxIterations: env.goalMaxIterations,
  limits: () => {
    const l = config.get().settings.limits;
    const disk = diskPercent();
    // The hard stop protects a box's data volume. On a laptop the data folder shares the system disk,
    // which other programs fill, so there it only warns.
    const own = env.expectDataMount || dataIsMounted();
    return { maxConcurrentRuns: l.maxConcurrentRuns, blocked: maintenance.blockedReason() ?? (own && disk !== null && disk >= l.diskStopPercent ? `the data disk is ${disk}% full (runs stop starting at ${l.diskStopPercent}%)` : null) };
  },
});
let coldStart: { at: string; sessions: string[] } | null = null;
function limitsView() {
  const l = config.get().settings.limits;
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const disk = diskPercent();
  return {
    ...l,
    activeRuns: count("select count(*) n from runs where status in ('starting','working','blocked')"),
    queuedRuns: count("select count(*) n from runs where status = 'queued'"),
    waiting: engine.waitingReason(),
    terminals: count("select count(*) n from terminals where closed_at is null"),
    diskPercent: disk,
    diskWarn: disk !== null && disk >= l.diskWarnPercent,
    diskStop: (env.expectDataMount || dataIsMounted()) && disk !== null && disk >= l.diskStopPercent,
  };
}
launcher.print = { finished: (id, r) => engine.printFinished(id, r) };
const services = new SupervisorBackend(env.supervisorPort);
const termLogin = new TermLogin(db, zellij, env.zellijTokensDb, `http://127.0.0.1:${env.zellijWebPort}`);
const support = new SupportAccess(db);
const identify = createAuth({
  mode: env.authMode,
  devEmail: env.devUserEmail,
  audience: env.iapAudience,
  production: env.nodeEnv === "production",
  settings: () => config.get().settings,
  secret: secretStore.resolve,
  bootstrapAdmin: env.bootstrapAdmin || undefined,
  support,
  sessionKey: sessionKey(),
});
const q = queries(db);
const allowedEmails = process.env.WB_ALLOWED_EMAILS ? process.env.WB_ALLOWED_EMAILS.split(",").map((s) => s.trim()).filter(Boolean) : null;

/** True when the data folder sits on its own filesystem (a volume or disk), so replacing the box keeps it. */
function dataIsMounted(): boolean {
  try {
    const root = process.env.WB_DATA_MOUNT ?? (DATA_DIR.startsWith("/data/") ? "/data" : DATA_DIR);
    return statSync(root).dev !== statSync(resolve(root, "..")).dev;
  } catch {
    return false;
  }
}

/** Claude Code's install and sign-in, checked at most every 30 seconds (the keychain check spawns a process). */
let claudeCache: { at: number; v: ReturnType<typeof detectClaude> } | null = null;
function claudeState() {
  if (claudeCache && Date.now() - claudeCache.at < 30_000) return claudeCache.v;
  const b = bin("claude");
  const found = existsSync(b) ? b : whichSync("claude");
  const v = detectClaude({
    bin: found,
    keychain: () => process.platform === "darwin" && spawnSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], { stdio: "ignore" }).status === 0,
  });
  claudeCache = { at: Date.now(), v };
  return v;
}
function whichSync(cmd: string): string | null {
  for (const d of (process.env.PATH ?? "").split(":")) if (d && existsSync(join(d, cmd))) return join(d, cmd);
  return null;
}

/** Signs session cookies (OIDC) and sign-in state; per box, on the data volume, so sessions survive restarts. */
function sessionKey(): Buffer {
  const f = join(DATA_DIR, "session.key");
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(f, "utf8").trim(), "hex");
}

/** The admin token gates setup tools on the loopback API. Only the human session is given it. */
function adminToken(): string {
  if (!existsSync(paths.adminToken)) writeFileSync(paths.adminToken, randomBytes(32).toString("hex"), { mode: 0o600 });
  chmodSync(paths.adminToken, 0o600);
  return readFileSync(paths.adminToken, "utf8").trim();
}

async function ensureSessions() {
  try {
    const created = await ensureStandingSessions(zellij, {
      layoutsDir: paths.layouts,
      terminals: config.get().terminals,
      services: (await services.list()).filter((s) => s.canRestart || s.kind !== "external"),
      wb: join(paths.cliBin, "wb"),
      workspace: WORKSPACE_DIR,
    });
    if (created.length) console.log("created zellij sessions:", created.join(", "));
    return created;
  } catch (e) {
    console.warn("could not ensure zellij sessions:", (e as Error).message);
    return [];
  }
}

// Workspace remote: follow Settings, pull on a timer and when a `workspace.updated` event arrives.
function syncRemoteSetting() {
  const want = config.get().settings.workspaceRemote || null;
  if ((workspace.state.remote ?? null) !== want) {
    workspace.setRemote(want);
    if (want) void workspace.sync("remote set");
  }
}
syncRemoteSetting();
setInterval(syncRemoteSetting, 5000);
setInterval(() => void workspace.sync("timer"), 5 * 60_000);

engine.listeners.push((e) => {
  if (e.type === "workspace.updated") void workspace.sync("event");
});

// Schedules
let crons: Cron[] = [];
function reloadSchedules() {
  for (const c of crons) c.stop();
  crons = [];
  if (config.get().settings.scheduler.mode !== "internal") return;
  for (const [id, s] of Object.entries(config.get().sources)) {
    if (!s.schedule) continue;
    crons.push(new Cron(s.schedule, { timezone: config.get().settings.timezone }, () => void engine.emit({ source: "schedule", type: s.type!, summary: `${s.title ?? id} (${s.schedule})`, payload: (s.payload as Record<string, unknown>) ?? {} })));
  }
}
let lastSchedules = "";
setInterval(() => {
  const j = JSON.stringify([config.get().sources, config.get().settings.scheduler, config.get().settings.timezone]);
  if (j !== lastSchedules) {
    lastSchedules = j;
    reloadSchedules();
  }
}, 5000);
new Cron("17 * * * *", () => void engine.cleanupSessions(config.get().settings.sessionRetentionHours));
// Limits: live runs older than maxRunSessionHours are stopped, so a forgotten session does not hold the box.
new Cron("*/10 * * * *", async () => {
  const cutoff = new Date(Date.now() - config.get().settings.limits.maxRunSessionHours * 3600_000).toISOString();
  const old = db.prepare("select id from runs where status in ('starting','working','blocked','idle') and coalesce(started_at, created_at) < ?").all(cutoff) as { id: number }[];
  for (const { id } of old) {
    await engine.stopRun(id).catch(() => {});
    db.prepare("update runs set error = ? where id = ?").run(`stopped after ${config.get().settings.limits.maxRunSessionHours} hours (Settings › Limits)`, id);
  }
  engine.launchQueued();
});
/** A token stays while its person still gets in (and, for typing tokens, is not a viewer). */
const reconcileTokens = () =>
  termLogin.reconcile((email, readOnly) => {
    if (allowedEmails && !allowedEmails.includes(email)) return false;
    const r = identify.roleFor(email);
    return !!r && (readOnly || r.role !== "viewer");
  });
new Cron("23 3 * * *", () => void reconcileTokens());
// People changes take effect on terminals at once, not only at night.
let lastAccess = JSON.stringify(config.get().settings.access);
setInterval(() => {
  const now = JSON.stringify(config.get().settings.access);
  if (now !== lastAccess) {
    lastAccess = now;
    void reconcileTokens().then((r) => r.length && console.log("revoked terminal tokens:", r.join(", ")));
  }
}, 5000);

/** Runs that were active when the app last stopped: print-mode children died with it; interactive ones may still be alive in Zellij. */
async function reconcileRuns() {
  const rows = db.prepare(`select * from runs where status in (${ACTIVE.map(() => "?").join(",")})`).all(...ACTIVE) as RunRow[];
  for (const r of rows) {
    const alive = r.mode === "interactive" && r.zellij_session ? await zellij.alive(r.zellij_session) : false;
    // The box stopped (sleep, redeploy, crash) under a live run: it can be resumed, so it did not fail.
    if (!alive) engine.setStatus(r.id, "interrupted", { ended_at: new Date().toISOString(), error: "the box stopped while this run was live; Resume carries on in the same session" });
  }
  // Idle interactive runs whose session went with the box can be resumed too.
  for (const r of db.prepare("select * from runs where status = 'idle' and mode = 'interactive' and session_deleted = 0").all() as RunRow[])
    if (r.zellij_session && !(await zellij.alive(r.zellij_session))) engine.setStatus(r.id, "interrupted", { error: "the box stopped while this run waited for input" });
  for (const { id } of db.prepare("select id from runs where status = 'queued' order by id").all() as { id: number }[]) await engine.maybeLaunch(id);
}

/** One-off layout fixes: the standing shell used to be called "claude". */
async function migrateLayouts() {
  try {
    await notifier.ready();
    for (const w of notifier.windows()) if (w.type === "terminal" && w.props.session === "claude") notifier.upsertWindow({ ...w, type: "terminal", props: { ...w.props, session: "shell" } } as any);
  } catch {}
}

const { pub, loc } = await createApp({
  maintenance,
  db, config, engine, launcher, notifier, layout: notifier, skills, q, services, zellij, termLogin, identify,
  authMode: env.authMode,
  login: env.authMode === "oidc" ? identify : null,
  bootstrapAdmin: env.bootstrapAdmin || undefined,
  setupFacts: () => ({ dataMount: { expected: env.expectDataMount, mounted: dataIsMounted() }, claude: claudeState() }),
  adminToken: adminToken(),
  hooksListenerUrl: `http://127.0.0.1:${env.hooksPort}`,
  defaultHooksUrl: env.defaultHooksUrl || null,
  secrets: secretStore.resolve,
  secretStore,
  workspaceDir: WORKSPACE_DIR,
  terminals: new Terminals(db, zellij, config, { layoutsDir: paths.layouts, workspace: WORKSPACE_DIR }),
  allowedEmails,
  reconcileTokens,
  ensureSessions,
  reloadSchedules,
  serveStatic: env.serveStatic ? { dir: paths.web } : null,
  activity,
  version: env.version,
  status: () => ({
    workspace: workspace.state,
    // "This box was asleep; terminals started fresh", for the first half hour after a cold start.
    coldStart: coldStart && Date.now() - Date.parse(coldStart.at) < 30 * 60_000 ? coldStart : null,
    limits: limitsView(),
    // Shown as a banner while the box drains for an update.
    drain: maintenance.drainStatus(),
    dataMount: { expected: env.expectDataMount, mounted: dataIsMounted() },
    box: config.get().settings.box,
    skillsDir: config.get().settings.skillsDir,
    // The editor is usable when it is switched on and installed; links to it then open folders at /code.
    editor: {
      on: config.get().settings.codeServer && existsSync(bin("code-server")),
      installed: existsSync(bin("code-server")),
      workspaceFile: paths.codeWorkspaceFile,
      workspaceDir: WORKSPACE_DIR,
      homeDir: homedir(),
    },
  }),
  workspace,
  deployKey,
});
await pub.listen({ host: process.env.WB_PUBLIC_HOST ?? "127.0.0.1", port: env.publicPort });
await loc.listen({ host: "127.0.0.1", port: env.localApiPort });
// Management API: only when the host gave a token, on its own port, for the private network.
support.onEvent = (type, g) =>
  void engine.emit({ source: "management", type, summary: `${type === "support.enabled" ? `Support access for ${g.email} (${g.role}) until ${g.expires_at}: ${g.reason}` : type === "support.used" ? `Support access used by ${g.email}` : `Support access for ${g.email} turned off`}`, actor: g.email, payload: { grant: g.id, email: g.email, role: g.role } });
if (env.managementToken) {
  if (env.managementToken.length < 24) console.error("WB_MANAGEMENT_TOKEN is shorter than 24 characters; the management API stays off");
  else {
    const mgmt = managementApp({
      token: env.managementToken, version: env.version, authMode: env.authMode, config, db, admin: new Admin(config, skills, () => q.openCounts()), activity,
      manifest: releaseManifest(env.version), dbState: () => dbState, maintenance,
      secrets: secretStore, support, limits: limitsView,
      emit: (e) => void engine.emit({ source: "management", type: e.type, summary: e.summary, actor: "management@workbench.local", payload: e.payload ?? {} }),
    });
    await mgmt.listen({ host: env.managementHost, port: env.managementPort });
    console.log(`management API on ${env.managementHost}:${env.managementPort}`);
  }
}
console.log(`workbench app on :${env.publicPort}, local API on 127.0.0.1:${env.localApiPort}, data in ${DATA_DIR}, workspace ${WORKSPACE_DIR}`);
await reconcileRuns();
{
  const created = await ensureSessions();
  const standing = config.get().terminals.map((t) => t.name);
  if (!firstBoot && created.some((c) => standing.includes(c))) coldStart = { at: new Date().toISOString(), sessions: created };
}
await migrateLayouts();

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await pub.close();
    await loc.close();
    notifier.close();
    db.close();
    process.exit(0);
  });
