// The box's process manager, used by `pnpm start` locally and as the container's entrypoint.
// Runs the workbench's own services plus any extra services in the workspace config, restarts
// crashes with backoff, writes per-service logs for the in-app views and structured lines to stdout,
// regenerates the door (Caddy) config from settings, and exposes list/restart/logs on 127.0.0.1 for
// the app's Services page.
import { SCRUB } from "./engine/runspec.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, type WriteStream } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigStore, type Config } from "./engine/config.ts";
import { caddyfile } from "./lib/caddyfile.ts";
import { createWorkspaceFromTemplate } from "./lib/workspace.ts";
import { DATA_DIR, env, paths, ROOT, TOOLS_DIR, WORKSPACE_DIR } from "./env.ts";

const MODE = (process.env.WB_MODE ?? (env.nodeEnv === "production" ? "prod" : "dev")) as "dev" | "prod";
const JSON_LOGS = process.env.WB_LOG_FORMAT ? process.env.WB_LOG_FORMAT === "json" : MODE === "prod";
if (MODE === "dev") process.env.WB_DEFAULT_HOOKS_URL ??= `http://localhost:${env.appDoorPort}`;
if (MODE === "prod") {
  process.env.WB_SERVE_STATIC = "1";
  process.env.NODE_ENV ??= "production";
}
// Started from inside a Claude Code session (or an admin shell), the box would pass that session's
// variables to every terminal and service: Claude Code in a terminal then turns transcripts off.
// Only Claude Code's own session variables: WB_* settings such as WB_MANAGEMENT_TOKEN are the box's config.
for (const k of Object.keys(process.env)) if ((SCRUB.includes(k) && k.startsWith("CLAUDE")) || /^CLAUDE_CODE_(SESSION|CHILD|MESSAGING)/.test(k)) delete process.env[k];
// The workspace's scripts (bin/) are on PATH in every terminal, as they are in runs.
process.env.PATH = [join(TOOLS_DIR, "bin"), join(ROOT, ".tools/bin"), join(ROOT, "packages/cli/bin"), join(WORKSPACE_DIR, "bin"), process.env.PATH].join(":");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(paths.logs, { recursive: true });
if (createWorkspaceFromTemplate(WORKSPACE_DIR, env.templateDir)) log("supervisor", `created workspace at ${WORKSPACE_DIR} from the template`);
const config = new ConfigStore(env.configPath);

function log(service: string, msg: string, level = "info") {
  if (JSON_LOGS) process.stdout.write(JSON.stringify(structured(level, service, msg)) + "\n");
  else process.stdout.write(`\x1b[2m${service.padEnd(11)}│\x1b[0m ${msg}\n`);
}

/** One JSON object per line. A child that already logs JSON (Caddy, Fastify) has its fields merged in, not nested as a string. */
function structured(level: string, service: string, msg: string): Record<string, unknown> {
  const base = { ts: new Date().toISOString(), level, service };
  if (msg.startsWith("{")) {
    try {
      const j = JSON.parse(msg) as Record<string, unknown>;
      const lvl = typeof j.level === "number" ? (j.level >= 50 ? "error" : j.level >= 40 ? "warn" : "info") : typeof j.level === "string" ? j.level : level;
      const { level: _l, ts: _t, time: _tm, ...rest } = j;
      return { ...base, ...rest, level: lvl, service, msg: String(j.msg ?? "") };
    } catch {}
  }
  return { ...base, msg };
}

interface Spec {
  id: string;
  title: string;
  kind: "core" | "workspace";
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  port?: number;
}

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) if (dir && existsSync(join(dir, cmd))) return join(dir, cmd);
  return null;
}

function writeCaddyfile(cfg: Config) {
  const text = caddyfile(cfg.settings, env.authMode, {
    appDoor: env.appDoorPort, hooksDoor: env.hooksDoorPort, app: env.publicPort, hooks: env.hooksPort, yjs: env.yjsPort,
    zellijWeb: env.zellijWebPort, codeServer: env.codeServerPort, vite: MODE === "dev" ? env.vitePort : null,
    // Natively the door listens on 127.0.0.1 unless WB_DOOR_BIND says otherwise; a container listens everywhere.
    bind: process.env.WB_DOOR_BIND ?? (MODE === "dev" ? "127.0.0.1 ::1" : ""),
    blocked: [env.localApiPort, env.managementPort, env.supervisorPort, env.publicPort, env.yjsPort, env.zellijWebPort, env.hooksPort],
  }, { codeServer: codeServerOn(cfg) });
  const prev = existsSync(paths.caddyfile) ? readFileSync(paths.caddyfile, "utf8") : "";
  if (prev !== text) writeFileSync(paths.caddyfile, text);
  return prev !== text;
}

function codeServerOn(cfg: Config) {
  return cfg.settings.codeServer && !!which("code-server");
}

function codeWorkspaceFile() {
  // A first-time editor should open on the files, not VS Code's welcome walkthrough.
  const userSettings = join(paths.codeServerData, "user/User/settings.json");
  if (!existsSync(userSettings)) {
    mkdirSync(join(paths.codeServerData, "user/User"), { recursive: true });
    writeFileSync(userSettings, JSON.stringify({ "workbench.startupEditor": "none", "workbench.tips.enabled": false, "telemetry.telemetryLevel": "off" }, null, 2));
  }
  // The workspace and the box user's home, where people and agents keep their own code. The editor's
  // File › Open Folder reaches anywhere else on the box.
  writeFileSync(paths.codeWorkspaceFile, JSON.stringify({ folders: [{ name: "workspace (box config)", path: WORKSPACE_DIR }, { name: "home", path: homedir() }] }, null, 2));
  return paths.codeWorkspaceFile;
}

function specs(cfg: Config): Spec[] {
  const node = process.execPath;
  const src = (f: string) => join(ROOT, "packages/app/src", f);
  const core: Spec[] = [
    { id: "yjs", title: "Sync (Yjs)", kind: "core", cmd: node, args: [src("yjs-server.ts")], cwd: ROOT, port: env.yjsPort },
    { id: "app", title: "Workbench app", kind: "core", cmd: node, args: [src("server.ts")], cwd: ROOT, port: env.publicPort },
    { id: "hooks", title: "Webhook listener", kind: "core", cmd: node, args: [src("hooks-listener.ts")], cwd: ROOT, port: env.hooksPort },
    { id: "zellij-web", title: "Terminals (Zellij web)", kind: "core", cmd: env.zellij, args: ["web", "--start", "--ip", "127.0.0.1", "--port", String(env.zellijWebPort)], cwd: ROOT, port: env.zellijWebPort },
    { id: "caddy", title: "Door (Caddy)", kind: "core", cmd: which("caddy") ?? "caddy", args: ["run", "--config", paths.caddyfile, "--adapter", "caddyfile"], cwd: ROOT, port: env.appDoorPort },
  ];
  if (MODE === "dev") {
    const vite = join(ROOT, "packages/app/node_modules/vite/bin/vite.js");
    core.splice(3, 0, { id: "web", title: "Frontend dev server (Vite)", kind: "core", cmd: node, args: [vite, "--port", String(env.vitePort)], cwd: join(ROOT, "packages/app"), port: env.vitePort });
  }
  if (codeServerOn(cfg))
    core.push({
      id: "code-server", title: "Editor (code-server)", kind: "core", cmd: which("code-server")!, cwd: WORKSPACE_DIR, port: env.codeServerPort,
      // Its own auth is off because the door already checked who you are; it listens on loopback only.
      args: ["--bind-addr", `127.0.0.1:${env.codeServerPort}`, "--auth", "none", "--disable-telemetry", "--disable-update-check", "--disable-workspace-trust",
        "--config", join(paths.codeServerData, "config.yaml"), "--user-data-dir", join(paths.codeServerData, "user"), "--extensions-dir", join(paths.codeServerData, "extensions"), codeWorkspaceFile()],
    });
  const extra: Spec[] = cfg.services
    .filter((s) => s.run)
    .map((s) => ({ id: s.id, title: s.title, kind: "workspace" as const, cmd: s.run!.cmd, args: s.run!.args, cwd: s.run!.cwd ? resolve(WORKSPACE_DIR, s.run!.cwd) : WORKSPACE_DIR, env: s.run!.env }));
  return [...core, ...extra];
}

interface Proc {
  spec: Spec;
  child: ChildProcess | null;
  state: "starting" | "running" | "stopped" | "crashed";
  since: string;
  restarts: number;
  wanted: boolean;
  backoff: number;
  log: WriteStream;
}
const procs = new Map<string, Proc>();

function start(p: Proc) {
  p.state = "starting";
  p.wanted = true;
  const child = spawn(p.spec.cmd, p.spec.args, { cwd: p.spec.cwd, env: { ...process.env, ...p.spec.env, FORCE_COLOR: JSON_LOGS ? "0" : "1" }, stdio: ["ignore", "pipe", "pipe"] });
  p.child = child;
  p.since = new Date().toISOString();
  const pipe = (d: Buffer) => {
    p.log.write(d);
    for (const line of d.toString().split("\n")) if (line.trim()) log(p.spec.id, line.replace(/\x1b\[[0-9;]*m/g, JSON_LOGS ? "" : "$&"));
  };
  child.stdout!.on("data", pipe);
  child.stderr!.on("data", pipe);
  child.on("error", (e) => log(p.spec.id, `could not start: ${e.message}`, "error"));
  child.on("spawn", () => {
    p.state = "running";
    setTimeout(() => (p.backoff = 1000), 10_000);
  });
  child.on("exit", (code, signal) => {
    p.child = null;
    p.log.write(`\n[supervisor] ${p.spec.id} exited code=${code} signal=${signal}\n`);
    if (!p.wanted) {
      p.state = "stopped";
      return;
    }
    p.state = "crashed";
    p.restarts++;
    const wait = p.backoff;
    p.backoff = Math.min(p.backoff * 2, 30_000);
    log(p.spec.id, `exited (${code ?? signal}); restarting in ${wait / 1000}s`, "warn");
    setTimeout(() => p.wanted && !p.child && start(p), wait);
  });
}

function stop(p: Proc): Promise<void> {
  p.wanted = false;
  const c = p.child;
  if (!c) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(() => c.kill("SIGKILL"), 5000);
    c.once("exit", () => {
      clearTimeout(t);
      res();
    });
    c.kill("SIGTERM");
  });
}

function add(spec: Spec) {
  const p: Proc = { spec, child: null, state: "stopped", since: new Date().toISOString(), restarts: 0, wanted: false, backoff: 1000, log: createWriteStream(join(paths.logs, `${spec.id}.log`), { flags: "a" }) };
  procs.set(spec.id, p);
  return p;
}

const same = (a: Spec, b: Spec) => JSON.stringify([a.cmd, a.args, a.cwd, a.env]) === JSON.stringify([b.cmd, b.args, b.cwd, b.env]);

/** Brings running processes in line with config: starts new ones, stops removed ones, restarts changed ones. */
async function reconcile(first = false) {
  const cfg = config.get();
  const caddyChanged = writeCaddyfile(cfg);
  const wanted = specs(cfg);
  for (const [id, p] of procs) if (!wanted.some((s) => s.id === id)) (await stop(p), procs.delete(id), log("supervisor", `stopped ${id} (removed from config)`));
  for (const spec of wanted) {
    const p = procs.get(spec.id);
    if (!p) {
      start(add(spec));
      if (first) await new Promise((r) => setTimeout(r, spec.id === "yjs" || spec.id === "app" ? 400 : 150));
    } else if (!same(p.spec, spec)) {
      await stop(p);
      p.spec = spec;
      start(p);
      log("supervisor", `restarted ${spec.id} (its command changed)`);
    } else if (spec.id === "caddy" && caddyChanged && !first) {
      await stop(p);
      start(p);
      log("supervisor", "restarted caddy (door settings changed)");
    }
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((r) => {
    const s = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => (s.destroy(), r(ok));
    s.setTimeout(300, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

// Refuse to start over a running box: starting twice would fight over ports and sessions.
const ports = [env.appDoorPort, env.publicPort, env.localApiPort, env.supervisorPort, env.zellijWebPort, env.yjsPort, env.hooksPort, ...(MODE === "dev" ? [env.vitePort] : [])];
const busy: number[] = [];
for (const port of ports) if (await portOpen(port)) busy.push(port);
if (busy.length) {
  log("supervisor", `ports already in use: ${busy.join(", ")}. The workbench (or something else) is already running; open http://localhost:${env.appDoorPort}, or stop the other copy first.`, "error");
  process.exit(1);
}

await reconcile(true);
// Installing the editor (wb tools install code-server) counts as a change too, so it starts without a restart.
const watched = () => JSON.stringify([config.get().services, config.get().settings.doors, codeServerOn(config.get())]);
let lastCfg = watched();
setInterval(() => {
  const now = watched();
  if (now !== lastCfg) {
    lastCfg = now;
    void reconcile();
  }
}, 2000);

function tail(file: string, lines: number): string {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").split("\n").slice(-lines - 1).join("\n");
}

function probe(port: number): Promise<boolean> {
  return portOpen(port);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const m = url.pathname.match(/^\/services(?:\/([^/]+)(?:\/(restart|stop|start|logs))?)?$/);
  const send = (code: number, body: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (!m) return send(404, { error: "not found" });
  const [, id, action] = m;
  if (!id) {
    const cfg = config.get();
    const listed = [...procs.values()].map((p) => ({ id: p.spec.id, title: p.spec.title, kind: p.spec.kind, state: p.state, pid: p.child?.pid, since: p.since, restarts: p.restarts, canRestart: true }));
    const probes = await Promise.all(
      cfg.services.filter((s) => !s.run && s.probe).map(async (s) => ({ id: s.id, title: s.title, kind: "external", state: (await probe(s.probe!.port)) ? "up" : "down", canRestart: false, detail: `port ${s.probe!.port}, managed outside the workbench` })),
    );
    const installed = !!which("code-server");
    const csOff = cfg.settings.codeServer && installed ? [] : [{
      id: "code-server", title: "Editor (code-server)", kind: "core", state: installed ? "off" : "not installed", canRestart: false,
      detail: !installed ? `${cfg.settings.codeServer ? "on" : "off"} in Settings; install it with: wb tools install code-server` : "installed; turn it on in Settings › General › Editor",
    }];
    return send(200, [...listed, ...probes, ...csOff]);
  }
  const p = procs.get(id);
  if (!p) return send(404, { error: `unknown service ${id}` });
  if (action === "logs") return send(200, tail(join(paths.logs, `${id}.log`), Number(url.searchParams.get("lines") ?? 200)), "text/plain");
  if (req.method !== "POST") return send(405, { error: "POST" });
  if (action === "restart" || action === "stop") await stop(p);
  if (action === "restart" || action === "start") {
    p.backoff = 1000;
    setTimeout(() => start(p), 50);
  }
  log("supervisor", `${action} ${id}`);
  send(200, { ok: true });
}).listen(env.supervisorPort, "127.0.0.1", () => log("supervisor", `${MODE} mode; control on 127.0.0.1:${env.supervisorPort}; workspace ${WORKSPACE_DIR}; data ${DATA_DIR}; door http://localhost:${env.appDoorPort}`));

let quitting = false;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    if (quitting) process.exit(1);
    quitting = true;
    log("supervisor", "stopping services…");
    await Promise.all([...procs.values()].map(stop));
    process.exit(0);
  });
