// Talking to the Acme box from the recorder: commands inside it, its API as a person, and waiting.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOX, sleep } from "./people.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SECRET = process.env.ACME_PROXY_SECRET ?? "acme-demo-proxy-secret";

export const sh = (cmd) => execFileSync("docker", ["exec", "-u", "workbench", "acme-box", "bash", "-lc", cmd], { encoding: "utf8" });
export const acme = (...args) => execFileSync(join(here, "../acme.sh"), args, { encoding: "utf8" });

export async function api(path, { as = "alice", method = "GET", body } = {}) {
  const r = await fetch(`${BOX}/api${path}`, {
    method,
    headers: { "X-Forwarded-Email": `${as}@acme.dev`, "X-Workbench-Proxy-Secret": SECRET, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

/** Polls fn until it returns something truthy. */
export async function until(fn, { timeout = 60000, every = 400, what = "a condition" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

export const ticket = (key) => JSON.parse(sh(`node -e 'const d=JSON.parse(require("fs").readFileSync("/data/internal/fake-jira.json","utf8"));console.log(JSON.stringify(d.tickets.find(t=>t.key==="${key}")??null))'`));
// A terminal window's text, read from its Zellij session (xterm draws to a canvas, so the page has none).
const sessions = {};
export async function screen(_person, windowId) {
  if (!sessions[windowId]) {
    const w = JSON.parse(sh("wb admin windows")).find((x) => x.id === windowId);
    sessions[windowId] = w?.props?.session;
  }
  try {
    return sh(`ZELLIJ_SOCKET_DIR=$(ls -d /tmp/wb-zj-* | head -1) zellij --session ${sessions[windowId]} action dump-screen`);
  } catch {
    return "";
  }
}
export const forget = () => Object.keys(sessions).forEach((k) => delete sessions[k]);
