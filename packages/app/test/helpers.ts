import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../src/engine/config.ts";
import { openDb } from "../src/engine/db.ts";
import { Engine } from "../src/engine/engine.ts";
import type { Launcher, RunRow } from "../src/engine/types.ts";
import { NullNotifier } from "../src/lib/signals.ts";

export class FakeLauncher implements Launcher {
  started: RunRow[] = [];
  stopped: number[] = [];
  steered: { id: number; text: string }[] = [];
  deleted: number[] = [];
  live = new Set<number>();
  async start(run: RunRow) {
    this.started.push(run);
    this.live.add(run.id);
    return { workdir: run.workdir ?? `/tmp/run-${run.id}`, zellij_session: run.zellij_session ?? undefined };
  }
  async stop(run: RunRow) {
    this.stopped.push(run.id);
    this.live.delete(run.id);
  }
  async steer(run: RunRow, text: string) {
    this.steered.push({ id: run.id, text });
  }
  async alive(run: RunRow) {
    return this.live.has(run.id);
  }
  async deleteSession(run: RunRow) {
    this.deleted.push(run.id);
    this.live.delete(run.id);
  }
}

export const baseConfig = {
  sources: {
    github: { path: "/hooks/github", verify: { kind: "hmac", secret: "GH_SECRET" }, adapter: "github" },
    deploy: { path: "/hooks/deploy", verify: { kind: "header", header: "X-Hook-Secret", secret: "DEPLOY_SECRET" }, map: { type: "deploy.finished", summary: "Deployed {{payload.sha}}", payload: { env: "$.environment", sha: "$.commit" } } },
  },
  groups: {
    jira: {
      title: "Jira", autonomy: "guarded", guard: ["Bash(jira delete*)", "mcp__jira__delete_*"],
      actions: [
        { id: "approve", label: "Approve", style: "primary", prompt: "/jira approved {{request.id}}" },
        { id: "changes", label: "Needs changes", input: { note: "text" }, prompt: "/jira changes {{request.id}}: {{input.note}}" },
      ],
    },
    house: { title: "House", autonomy: "autonomous" },
    repo: { title: "Shared folder work", autonomy: "autonomous", workdir: "/tmp/wb-shared-folder" },
  },
  rules: [
    { id: "merged", on: "github.pull_request.merged", prompt: "/house post-merge {{payload.repo}} #{{payload.number}}", group: "house", title: "PR #{{payload.number}}" },
    { id: "only-shop", on: "github.push", filter: { repo: "example/shop" }, prompt: "/house push", group: "house" },
    { id: "any-deploy", on: "deploy.*", prompt: "/house deploy {{payload.env}}", group: "house", mode: "print" },
  ],
  services: [],
};

export function setup(cfg: unknown = baseConfig, opts: { goal?: (g: string) => { ok: boolean; output: string } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wb-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(cfg));
  const config = new ConfigStore(path);
  const db = openDb(":memory:");
  const launcher = new FakeLauncher();
  const notifier = new NullNotifier();
  const engine = new Engine({
    db, config, launcher, notifier, goalMaxIterations: 2,
    runGoal: async (g) => (opts.goal ? opts.goal(g) : { ok: true, output: "" }),
  });
  return { engine, launcher, notifier, config, db, dir, path };
}

export const tick = () => new Promise((r) => setTimeout(r, 5));
