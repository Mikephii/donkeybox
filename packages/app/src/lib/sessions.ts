import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Terminal } from "../engine/config.ts";
import type { Zellij } from "./zellij.ts";

const q = (s: string) => JSON.stringify(s);

/** Keep Zellij's tab bar and key hints; a layout with explicit tabs otherwise drops them. */
const TAB_TEMPLATE = `    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=1 borderless=true {
            plugin location="zellij:status-bar"
        }
    }
`;

const tab = (name: string, body: string, focus = false) => `    tab name=${q(name)}${focus ? " focus=true" : ""} {\n${body}\n    }\n`;
const command = (cmd: string, args: string[]) => `        pane command=${q(cmd)} {\n            args ${args.map(q).join(" ")}\n        }`;
const layout = (cwd: string, tabs: string) => `layout {\n    cwd ${q(cwd)}\n${TAB_TEMPLATE}${tabs}}\n`;

/** "workspace", or a folder (absolute, or relative to the workspace). */
export function resolveCwd(cwd: string, o: { workspace: string }): string {
  if (!cwd || cwd === "workspace") return o.workspace;
  if (isAbsolute(cwd)) return cwd;
  return join(o.workspace, cwd);
}

/** A shell in a folder, optionally running a command first and then staying open. */
export function shellLayout(cwd: string, title: string, cmd?: string): string {
  const body = cmd ? command("bash", ["-lc", `${cmd}; exec "\${SHELL:-bash}" -l`]) : "        pane";
  return layout(cwd, tab(title, body, true));
}

/** One tab per service tailing its log, plus a ctl tab with the svc menu. */
export function servicesLayout(services: { id: string }[], wb: string, cwd: string): string {
  return layout(cwd, services.map((s) => tab(s.id, command(wb, ["svc", "logs", s.id]))).join("") + tab("ctl", command(wb, ["svc"]), true));
}

export interface StandingOptions {
  layoutsDir: string;
  terminals: Terminal[];
  services: { id: string }[];
  wb: string;
  workspace: string;
  }

export function standingLayout(t: Terminal, o: StandingOptions): string {
  const cwd = resolveCwd(t.cwd, o);
  return t.layout === "services" ? servicesLayout(o.services, o.wb, cwd) : shellLayout(cwd, t.name, t.command);
}

/** Creates any standing terminal from config that is not running. Returns the names it created. */
export async function ensureStandingSessions(z: Zellij, o: StandingOptions): Promise<string[]> {
  mkdirSync(o.layoutsDir, { recursive: true });
  const sessions = await z.list();
  const created: string[] = [];
  for (const t of o.terminals) {
    const path = join(o.layoutsDir, `${t.name}.kdl`);
    writeFileSync(path, standingLayout(t, o));
    const s = sessions.find((x) => x.name === t.name);
    if (s && !s.exited) continue;
    if (s?.exited) await z.delete(t.name);
    mkdirSync(resolveCwd(t.cwd, o), { recursive: true });
    await z.createWithLayout(t.name, path, t.layout === "services" ? "ctl" : t.name);
    created.push(t.name);
  }
  return created;
}
