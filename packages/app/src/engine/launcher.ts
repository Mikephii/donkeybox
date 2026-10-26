import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import type { ConfigStore } from "./config.ts";
import { buildRunSpec, type RunSpecEnv } from "./runspec.ts";
import type { Launcher, RunRow } from "./types.ts";
import type { Zellij } from "../lib/zellij.ts";

/** Pane id of the agent inside a run session: the session's first and only pane. */
export const RUN_PANE = "terminal_0";

export interface PrintCallbacks {
  finished(id: number, r: { code: number | null; result?: string; cost?: number; error?: string }): void;
}

export class AgentLauncher implements Launcher {
  zellij: Zellij;
  config: ConfigStore;
  specEnv: RunSpecEnv;
  print: PrintCallbacks | null = null;
  /** Marks a run folder as trusted in Claude Code's config so no dialog blocks an unattended run. */
  trust: ((folder: string) => Promise<unknown>) | null = null;
  private children = new Map<number, ReturnType<typeof spawn>>();

  constructor(zellij: Zellij, config: ConfigStore, specEnv: RunSpecEnv) {
    this.zellij = zellij;
    this.config = config;
    this.specEnv = specEnv;
  }

  async start(run: RunRow) {
    const group = this.config.get().groups[run.group_id];
    if (!group) throw new Error(`unknown group ${run.group_id}`);
    const spec = buildRunSpec(run, run.group_id, group, this.specEnv, run.mode === "print");
    await this.trust?.(spec.workdir);
    if (run.mode === "print") {
      this.startPrint(run, spec.script, spec.dir);
      return { workdir: spec.workdir };
    }
    const name = run.zellij_session!;
    await this.zellij.createWithCommand(name, ["bash", spec.script]);
    return { zellij_session: name, workdir: spec.workdir };
  }

  private startPrint(run: RunRow, script: string, dir: string) {
    const log = createWriteStream(join(dir, "stream.jsonl"));
    const child = spawn("bash", [script], { stdio: ["ignore", "pipe", "pipe"] });
    this.children.set(run.id, child);
    let buf = "";
    let result: string | undefined;
    let cost: number | undefined;
    let error: string | undefined;
    child.stdout!.on("data", (d: Buffer) => {
      log.write(d);
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.type === "result") {
            result = msg.result;
            cost = msg.total_cost_usd;
            if (msg.is_error) error = msg.result ?? msg.subtype;
          }
        } catch {}
      }
    });
    child.stderr!.on("data", (d: Buffer) => log.write(d));
    child.on("exit", (code) => {
      this.children.delete(run.id);
      log.end();
      this.print?.finished(run.id, { code: error ? 1 : code, result, cost, error });
    });
  }

  async stop(run: RunRow) {
    const child = this.children.get(run.id);
    if (child) child.kill("SIGTERM");
    if (run.mode === "interactive" && run.zellij_session) await this.zellij.kill(run.zellij_session);
  }

  async steer(run: RunRow, text: string) {
    if (!run.zellij_session) throw new Error("run has no session");
    if (!(await this.zellij.alive(run.zellij_session))) throw new Error("run session is not running");
    const single = text.replace(/\s*\n\s*/g, " ").trim();
    await this.zellij.writeChars(run.zellij_session, RUN_PANE, single);
    await new Promise((r) => setTimeout(r, 150));
    await this.zellij.pressEnter(run.zellij_session, RUN_PANE);
  }

  async alive(run: RunRow) {
    if (run.mode === "print") return this.children.has(run.id);
    return run.zellij_session ? this.zellij.alive(run.zellij_session) : false;
  }

  async deleteSession(run: RunRow) {
    if (run.zellij_session) await this.zellij.delete(run.zellij_session);
  }
}
