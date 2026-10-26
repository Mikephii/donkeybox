// wb: the workbench CLI. Talks to the app's loopback API; used by agents, hooks, people in terminals and the supervisor.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(process.env.WB_PRODUCT_DIR ?? process.env.WB_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const API = process.env.WB_LOCAL_API ?? "http://127.0.0.1:8001";
const RUN = process.env.WB_RUN_ID ? Number(process.env.WB_RUN_ID) : undefined;

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${API}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d: any = t;
  try {
    d = JSON.parse(t);
  } catch {}
  if (!r.ok) throw new Error(typeof d === "string" ? d : d.error ?? (d.errors ?? []).join("\n"));
  return d;
}

const print = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));

const HELP = `wb - workbench CLI

  wb request --title T [--body B | --body-file F] [--group G] [--action id:Label]... [--wait]
                                   raise a request (deferred; --wait blocks until answered)
  wb note "text"                   post a note to the current run's timeline
  wb open FILE.md [--title T]      show a markdown file as a Document window beside this terminal
  wb requests [--status S] [--group G]
  wb approved [--group G]          answered requests whose chosen action was approve/allow
  wb emit TYPE [--summary S] [--payload JSON]
  wb run --group G --prompt P [--title T] [--goal CMD] [--print]
  wb runs [--live]
  wb svc                           interactive service menu
  wb svc status | logs ID | restart ID
  wb sessions ensure | cleanup [--hours N]
  wb tokens reconcile

  wb secrets                       names, where each is used, and whether it is set
  wb secrets set NAME              store a value read from stdin (not your shell history)
  wb secrets generate NAME         store 32 random bytes and print them once
  wb secrets rotate NAME [--generate]
  wb secrets delete NAME           refused while config.json refers to it

  wb tools list                    pinned programs and whether each is installed
  wb tools install NAME            code-server, claude-code, zellij or caddy, into the tools folder

  wb migrate-workspace [--from DIR] [--to DIR]
                                   one-off: move an old workflows/ folder into a workspace repo

  wb admin ...                     setup tools for the human claude session (refused inside runs)
    workflows [get ID | put ID --file GROUP.json [--skill] | delete ID [--skill]]
    skills [get NAME | put NAME --file SKILL.md]
    rules [put --file RULE.json | delete ID]
    sources [put ID --file SOURCE.json | delete ID | test ID [--rules]]
    terminals [new --title T [--cwd workspace|/path] [--command CMD] | close NAME]
    canvases [put ID --title T | delete ID]
    windows [--canvas C | put --file WINDOW.json | delete ID]
    drain [--timeout SECONDS] | undrain   stop starting runs before stopping the box for an update
    backup | backups                 copy the database, the box's config repo and secrets into the internal folder

  wb manifest IMAGE                print the release manifest an image carries (its label), from Docker or the registry

  wb update --to VERSION --via compose|gcp|fly [--image REF] [--timeout SECONDS] [--dry-run]
                                   update a hosted box through its management API; see docs/hosting/updating.md`;

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "manifest": {
      const image = rest[0];
      if (!image) throw new Error("usage: wb manifest IMAGE");
      const { readImageManifest } = await import("./image-manifest.ts");
      const m = await readImageManifest(image);
      if (!m) {
        console.error(`no release manifest for ${image} (no org.donkeybox.release label locally or in its registry)`);
        process.exitCode = 1;
        return;
      }
      print(m);
      return;
    }
    case "open": {
      if (RUN) throw new Error("wb open is for people's terminals; a run puts what it found in a request or a note");
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { title: { type: "string" } } });
      if (!positionals[0]) throw new Error("usage: wb open FILE.md [--title T]");
      const w = await adminCall("POST", "/docs/open", { path: resolve(positionals[0]), session: process.env.ZELLIJ_SESSION_NAME, title: values.title });
      return console.log(`Opened ${w.props.path} in a Document window on the ${w.canvasId} canvas.`);
    }
    case "request":
    case "propose": {
      const { values } = parseArgs({
        args: rest,
        options: { title: { type: "string" }, body: { type: "string" }, "body-file": { type: "string" }, group: { type: "string" }, action: { type: "string", multiple: true }, wait: { type: "boolean" } },
      });
      if (!values.title) throw new Error("--title is required");
      const body = values["body-file"] ? readFileSync(values["body-file"], "utf8") : values.body ?? "";
      const group = values.group ?? (RUN ? (await call("GET", `/runs/${RUN}`)).group_id : undefined);
      if (!group) throw new Error("--group is required outside a run");
      const actions = values.action?.map((a) => {
        const [id, ...label] = a.split(":");
        return { id: id!, label: label.join(":") || id! };
      });
      const r = await call("POST", "/requests", { title: values.title, body, group, actions, mode: values.wait ? "blocking" : "deferred", run_id: RUN });
      if (!values.wait) return print(`request #${r.id} raised in ${group}`);
      for (;;) {
        const s = await call("GET", `/requests/${r.id}/answer?wait=1&timeout=25`);
        if (s.status !== "open") return print(s.answer ?? s);
      }
    }
    case "note":
      await call("POST", "/notes", { text: rest.join(" "), run_id: RUN });
      return print("noted");
    case "requests": {
      const { values } = parseArgs({ args: rest, options: { status: { type: "string" }, group: { type: "string" } } });
      const rows = await call("GET", `/requests?${new URLSearchParams(values as Record<string, string>)}`);
      return rows.forEach((r: any) => console.log(`#${r.id}\t${r.status}\t${r.group_id}\t${r.title}${r.answer ? `\t→ ${r.answer.action_id} (${r.answer.actor})` : ""}`));
    }
    case "approved": {
      const { values } = parseArgs({ args: rest, options: { group: { type: "string" } } });
      const qs = new URLSearchParams({ status: "answered", ...(values.group ? { group: values.group } : {}) });
      const rows = (await call("GET", `/requests?${qs}`)).filter((r: any) => ["approve", "allow"].includes(r.answer?.action_id));
      return rows.forEach((r: any) => console.log(`#${r.id}\t${r.group_id}\t${r.title}\t(${r.answer.actor})`));
    }
    case "emit": {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { summary: { type: "string" }, payload: { type: "string" } } });
      return print(await call("POST", "/events", { source: RUN ? "agent" : "cli", type: positionals[0], summary: values.summary, payload: values.payload ? JSON.parse(values.payload) : {}, run_id: RUN }));
    }
    case "run": {
      const { values } = parseArgs({ args: rest, options: { group: { type: "string" }, prompt: { type: "string" }, title: { type: "string" }, goal: { type: "string" }, print: { type: "boolean" } } });
      const r = await call("POST", "/runs", { group: values.group, prompt: values.prompt, title: values.title, goal: values.goal, mode: values.print ? "print" : "interactive", actor: process.env.USER });
      return print(`run #${r.id} ${r.status} (session ${r.zellij_session})`);
    }
    case "runs": {
      const { values } = parseArgs({ args: rest, options: { live: { type: "boolean" } } });
      const rows = await call("GET", `/runs?${values.live ? "live=1" : ""}`);
      return rows.forEach((r: any) => console.log(`#${r.id}\t${r.status}\t${r.group_id}\t${r.title}${r.cost_usd != null ? `\t$${r.cost_usd.toFixed(4)}` : ""}`));
    }
    case "svc":
      return svc(rest);
    case "sessions":
      if (rest[0] === "ensure") return print(await call("POST", "/sessions/ensure"));
      if (rest[0] === "cleanup") {
        const { values } = parseArgs({ args: rest.slice(1), options: { hours: { type: "string" } } });
        return print(await call("POST", "/sessions/cleanup", { hours: values.hours ? Number(values.hours) : undefined }));
      }
      throw new Error("wb sessions ensure|cleanup");
    case "tokens":
      return print(await call("POST", "/tokens/reconcile"));
    case "admin":
      return adminCmd(rest);
    case "secrets":
      return secretsCmd(rest);
    case "update": {
      const { values } = parseArgs({
        args: rest,
        options: { to: { type: "string" }, via: { type: "string" }, image: { type: "string" }, manifest: { type: "string" }, timeout: { type: "string" }, "drain-timeout": { type: "string" }, "dry-run": { type: "boolean" }, url: { type: "string" }, driver: { type: "string" } },
      });
      const { updateCommand } = await import("./update.ts");
      process.exitCode = await updateCommand(values, ROOT);
      return;
    }
    case "tools": {
      const r = spawnSync(process.execPath, [join(ROOT, "packages/app/src/tools.ts"), ...rest], { stdio: "inherit" });
      process.exit(r.status ?? 1);
    }
    case "migrate-workspace": {
      const r = spawnSync(process.execPath, [join(ROOT, "packages/app/src/migrate-workspace.ts"), ...rest], { stdio: "inherit" });
      process.exit(r.status ?? 1);
    }
    default:
      console.log(HELP);
  }
}

// ── admin (setup) ──
function adminToken(): string {
  if (process.env.WB_ADMIN_TOKEN) return process.env.WB_ADMIN_TOKEN;
  const file = join(process.env.WB_DATA_DIR ?? join(ROOT, "data"), "admin.token");
  if (!existsSync(file)) throw new Error(`no admin token at ${file}; start the workbench app first`);
  return readFileSync(file, "utf8").trim();
}

async function adminCall(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${API}/admin${path}`, {
    method,
    headers: { "x-wb-admin-token": adminToken(), ...(process.env.WB_ACTOR ? { "x-wb-actor": process.env.WB_ACTOR } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  const d = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error([d?.error ?? `HTTP ${r.status}`, ...(d?.errors ?? [])].join("\n"));
  return d;
}

async function adminCmd(args: string[]) {
  // Runs have WB_RUN_ID set and may only call `wb ...` (their allow list), so this check holds for them.
  if (RUN) throw new Error("admin commands are for the human claude session, not for runs");
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { file: { type: "string" }, skill: { type: "boolean" }, rules: { type: "boolean" }, canvas: { type: "string" }, title: { type: "string" }, cwd: { type: "string" }, command: { type: "string" }, timeout: { type: "string" } } });
  const [what, verb, id] = positionals;
  const file = () => {
    if (!values.file) throw new Error("--file is required");
    const text = readFileSync(values.file, "utf8");
    return values.file.endsWith(".json") ? JSON.parse(text) : text;
  };
  switch (`${what} ${verb ?? ""}`.trim()) {
    case "workflows": return print(await adminCall("GET", "/workflows"));
    case "workflows get": return print(await adminCall("GET", `/workflows/${id}`));
    case "workflows put": return print(await adminCall("PUT", `/workflows/${id}`, { group: file(), skill: values.skill }));
    case "workflows delete": return print(await adminCall("DELETE", `/workflows/${id}${values.skill ? "?skill=1" : ""}`));
    case "skills": return print(await adminCall("GET", "/skills"));
    case "skills get": return print((await adminCall("GET", `/skills/${id}`)).content);
    case "skills put": return print(await adminCall("PUT", `/skills/${id}`, { content: file() }));
    case "rules": return print(await adminCall("GET", "/rules"));
    case "rules put": {
      const rule = file();
      return print(await adminCall("PUT", `/rules/${rule.id}`, rule));
    }
    case "rules delete": return print(await adminCall("DELETE", `/rules/${id}`));
    case "sources": return print(await adminCall("GET", "/sources"));
    case "sources put": return print(await adminCall("PUT", `/sources/${id}`, { source: file() }));
    case "sources delete": return print(await adminCall("DELETE", `/sources/${id}`));
    case "sources test": return print(await adminCall("POST", `/sources/${id}/test`, { triggerRules: values.rules === true }));
    case "terminals": return print(await adminCall("GET", "/terminals"));
    case "terminals new": return print(await adminCall("POST", "/terminals", { title: values.title, cwd: values.cwd, command: values.command }));
    case "terminals close": return print(await adminCall("DELETE", `/terminals/${id}`));
    case "canvases": return print(await adminCall("GET", "/canvases"));
    case "canvases put": return print(await adminCall("PUT", `/canvases/${id}`, { title: values.title ?? id }));
    case "canvases delete": return print(await adminCall("DELETE", `/canvases/${id}`));
    case "windows": return print(await adminCall("GET", `/windows${values.canvas ? `?canvas=${values.canvas}` : ""}`));
    case "windows put": return print(await adminCall("POST", "/windows", file()));
    case "windows delete": return print(await adminCall("DELETE", `/windows/${id}`));
    case "drain": return print(await adminCall("POST", "/drain", { timeoutSeconds: values.timeout ? Number(values.timeout) : undefined }));
    case "undrain": return print(await adminCall("POST", "/undrain", {}));
    case "backup": return print(await adminCall("POST", "/backup", {}));
    case "backups": return print(await adminCall("GET", "/backups"));
    default:
      console.log(HELP);
  }
}

// ── secrets (admin token; values come from stdin and are printed only when generated) ──
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const v = await rl.question("value: ");
    rl.close();
    return v;
  }
  let s = "";
  for await (const c of process.stdin) s += c;
  return s.replace(/\r?\n$/, "");
}
async function secretsCmd(args: string[]) {
  if (RUN) throw new Error("secrets are managed by people, not runs");
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { generate: { type: "boolean" } } });
  const [verb, name] = positionals;
  switch (verb ?? "list") {
    case "list": {
      const rows = await adminCall("GET", "/secrets");
      for (const s of rows) console.log(`${s.name.padEnd(28)} ${(s.from ?? "MISSING").padEnd(8)} ${s.usedBy.map((u: any) => u.where).join(", ") || "unused"}`);
      return;
    }
    case "set": return print(await adminCall("POST", "/secrets", { name, value: await readStdin() }));
    case "generate": return print((await adminCall("POST", "/secrets", { name, generate: true })).value);
    case "rotate": {
      const r = await adminCall("POST", `/secrets/${name}/rotate`, values.generate ? { generate: true } : { value: await readStdin() });
      return print(r.value ?? `rotated ${name}`);
    }
    case "delete": return print(await adminCall("DELETE", `/secrets/${name}`));
    default: console.log(HELP);
  }
}

// ── services ──
async function svcStatus() {
  const rows = await call("GET", "/services");
  for (const s of rows) console.log(`${s.id.padEnd(12)} ${s.state.padEnd(9)} ${s.pid ? `pid ${s.pid}` : ""}${s.restarts ? `  restarts ${s.restarts}` : ""}  ${s.title}`);
  return rows;
}

async function svcLogs(id: string) {
  const rows = await call("GET", "/services").catch(() => []);
  const s = rows.find((x: any) => x.id === id);
  if (s && s.kind === "external") {
    console.log(`${s.title} is managed outside the workbench; watching it.`);
    setInterval(async () => {
      const now = await call("GET", "/services").catch(() => []);
      console.log(`${new Date().toLocaleTimeString()}  ${id}: ${now.find((x: any) => x.id === id)?.state ?? "unknown"}`);
    }, 10_000);
    return;
  }
  const file = join(process.env.WB_DATA_DIR ?? join(ROOT, "data"), "logs", `${id}.log`);
  if (!existsSync(file)) console.log(`waiting for ${file}…`);
  spawn("tail", ["-n", "200", "-F", file], { stdio: "inherit" });
}

async function svc(args: string[]) {
  const [sub, id] = args;
  if (sub === "status") return void (await svcStatus());
  if (sub === "logs" && id) return svcLogs(id);
  if (sub === "restart" && id) return print(await call("POST", `/services/${id}/restart`));
  // interactive menu for the services session's ctl tab
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    console.log("\n── workbench services ──");
    await svcStatus().catch((e) => console.log(`app unreachable: ${e.message}`));
    const line = (await rl.question("\n[r ID] restart  [l ID] logs  [g ID PATTERN] grep logs  [enter] refresh  [q] quit > ")).trim();
    const [c, a, ...pat] = line.split(/\s+/);
    try {
      if (c === "q") return rl.close();
      if (c === "r" && a) print(await call("POST", `/services/${a}/restart`));
      if (c === "l" && a) {
        const r = await fetch(`${API}/services/${a}/logs?lines=60`);
        console.log(await r.text());
      }
      if (c === "g" && a) {
        const r = await fetch(`${API}/services/${a}/logs?lines=2000`);
        const re = new RegExp(pat.join(" "), "i");
        console.log((await r.text()).split("\n").filter((l) => re.test(l)).join("\n") || "(no matches)");
      }
    } catch (e) {
      console.log((e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error(`wb: ${(e as Error).message}`);
  process.exit(1);
});
