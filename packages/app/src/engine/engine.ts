import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ConfigStore, Group, Rule } from "./config.ts";
import type { DB } from "./db.ts";
import { firstGuardMatch, globToRegex, toolSubject } from "./guard.ts";
import { getPath, render } from "./template.ts";
import {
  ACTIVE, SETTLED,
  type Answer, type EventRow, type Launcher, type Notifier, type RequestAction, type RequestRow, type RunRow, type RunStatus,
} from "./types.ts";

export interface EmitInput {
  source: string;
  type: string;
  summary?: string;
  actor?: string;
  payload?: Record<string, unknown>;
  run_id?: number | null;
  dedupe_key?: string;
  /** A test delivery from the Sources page: recorded, but no rules fire. */
  test?: boolean;
}

export interface StartRunInput {
  group: string;
  prompt: string;
  title?: string;
  mode?: "interactive" | "print";
  goal?: string;
  trigger_event_id?: number | null;
  rule_id?: string | null;
  parent_run_id?: number | null;
  resume_session_id?: string | null;
  workdir?: string | null;
  actor?: string | null;
}

export interface CreateRequestInput {
  group: string;
  title: string;
  body?: string;
  actions?: RequestAction[];
  mode?: "blocking" | "deferred" | "guard";
  origin_run_id?: number | null;
  tool?: Record<string, unknown>;
}

const DEFAULT_ACTIONS: RequestAction[] = [
  { id: "approve", label: "Approve", style: "primary" },
  { id: "reject", label: "Reject", style: "danger" },
];

const GUARD_ACTIONS: RequestAction[] = [
  { id: "allow", label: "Allow", style: "primary" },
  { id: "deny", label: "Deny", style: "danger", input: { reason: "string" } },
];

const now = () => new Date().toISOString();

export function matchesRule(rule: Rule, type: string, payload: Record<string, unknown>): boolean {
  if (!rule.enabled) return false;
  if (!globToRegex(rule.on).test(type)) return false;
  for (const [k, want] of Object.entries(rule.filter)) {
    const got = getPath(payload, k);
    if (Array.isArray(want)) {
      if (!want.some((w) => w === got)) return false;
    } else if (typeof want === "string" && want.includes("*")) {
      if (typeof got !== "string" || !globToRegex(want).test(got)) return false;
    } else if (got !== want) return false;
  }
  return true;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16).replace(/-$/, "") || "run";
}

export interface EngineOptions {
  db: DB;
  config: ConfigStore;
  launcher: Launcher;
  notifier: Notifier;
  goalMaxIterations?: number;
  runGoal?: (goal: string, cwd: string) => Promise<{ ok: boolean; output: string }>;
  /** Box limits checked before a run starts; a reason keeps the run queued. */
  limits?: () => { maxConcurrentRuns: number; blocked: string | null };
}

export class Engine {
  db: DB;
  config: ConfigStore;
  launcher: Launcher;
  notifier: Notifier;
  goalMaxIterations: number;
  runGoal: (goal: string, cwd: string) => Promise<{ ok: boolean; output: string }>;
  private answers = new EventEmitter();
  /** Called for every stored event (after rules ran). */
  listeners: ((e: EventRow) => void)[] = [];

  constructor(o: EngineOptions) {
    this.db = o.db;
    this.config = o.config;
    this.launcher = o.launcher;
    this.notifier = o.notifier;
    this.goalMaxIterations = o.goalMaxIterations ?? 6;
    this.runGoal = o.runGoal ?? defaultRunGoal;
    this.limits = o.limits;
    this.answers.setMaxListeners(0);
  }

  // ───────────── reads ─────────────
  getRun(id: number): RunRow | undefined {
    return this.db.prepare("select * from runs where id = ?").get(id) as RunRow | undefined;
  }
  getRequest(id: number): RequestRow | undefined {
    return this.db.prepare("select * from requests where id = ?").get(id) as RequestRow | undefined;
  }
  getEvent(id: number): EventRow | undefined {
    return this.db.prepare("select * from events where id = ?").get(id) as EventRow | undefined;
  }
  private group(id: string): Group {
    const g = this.config.get().groups[id];
    if (!g) throw new Error(`unknown group ${id}`);
    return g;
  }

  // ───────────── events ─────────────
  emit(input: EmitInput): { event: EventRow; runs: RunRow[]; duplicate: boolean } {
    if (input.dedupe_key) {
      const existing = this.db.prepare("select * from events where dedupe_key = ?").get(input.dedupe_key) as EventRow | undefined;
      if (existing) return { event: existing, runs: [], duplicate: true };
    }
    const payload = input.payload ?? {};
    const info = this.db
      .prepare("insert into events (source, type, summary, actor, payload, run_id, dedupe_key) values (?,?,?,?,?,?,?)")
      .run(input.source, input.type, (input.test ? "[test] " : "") + (input.summary ?? input.type), input.actor ?? null, JSON.stringify(input.test ? { ...payload, _test: true } : payload), input.run_id ?? null, input.dedupe_key ?? null);
    const event = this.getEvent(Number(info.lastInsertRowid))!;
    this.notifier.signal("events", { id: event.id, run_id: event.run_id });
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {}
    }
    const runs: RunRow[] = [];
    // Hook chatter and test deliveries never trigger rules; everything else can.
    if (input.source !== "hook" && !input.test) {
      for (const rule of this.config.get().rules) {
        if (!matchesRule(rule, input.type, payload)) continue;
        const ctx = { payload, event: { ...event, payload }, actor: input.actor };
        runs.push(
          this.startRun({
            group: rule.group,
            prompt: render(rule.prompt, ctx),
            title: rule.title ? render(rule.title, ctx) : event.summary ?? rule.id,
            mode: rule.mode,
            goal: rule.goal,
            trigger_event_id: event.id,
            rule_id: rule.id,
            actor: input.actor ?? null,
          }),
        );
      }
    }
    return { event, runs, duplicate: false };
  }

  // ───────────── runs ─────────────
  startRun(input: StartRunInput): RunRow {
    const group = this.group(input.group);
    const sessionId = input.resume_session_id ?? randomUUID();
    const info = this.db
      .prepare(
        `insert into runs (group_id, rule_id, title, prompt, mode, status, session_id, resume_session_id, trigger_event_id,
          parent_run_id, goal, model, repo, workdir, actor, updated_at)
         values (?,?,?,?,?, 'queued', ?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.group, input.rule_id ?? null, (input.title ?? input.prompt).slice(0, 140), input.prompt, input.mode ?? "interactive",
        sessionId, input.resume_session_id ?? null, input.trigger_event_id ?? null, input.parent_run_id ?? null,
        input.goal ?? null, group.model ?? this.config.get().settings.defaultModel ?? null,
        // Runs of a workflow that share a working folder take turns unless the workflow allows parallel runs.
        group.workdir && !group.parallel ? `dir:${group.workdir}` : null, input.workdir ?? null, input.actor ?? null, now(),
      );
    const id = Number(info.lastInsertRowid);
    this.db.prepare("update runs set zellij_session = ? where id = ?").run(`run-${id}-${slug(input.title ?? input.group)}`, id);
    this.notifier.signal("runs", { id });
    void this.maybeLaunch(id);
    return this.getRun(id)!;
  }

  /** Another live run is using this run's shared working folder (the column is named repo for history). */
  private repoBusy(run: RunRow): boolean {
    if (!run.repo) return false;
    const row = this.db
      .prepare(`select count(*) n from runs where repo = ? and id != ? and status in (${ACTIVE.map(() => "?").join(",")})`)
      .get(run.repo, run.id, ...ACTIVE) as { n: number };
    return row.n > 0;
  }

  /** Why queued runs are not starting right now (limits), or null. */
  waitingReason(): string | null {
    const l = this.limits?.();
    if (!l) return null;
    if (l.blocked) return l.blocked;
    const n = (this.db.prepare(`select count(*) n from runs where status in (${ACTIVE.map(() => "?").join(",")})`).get(...ACTIVE) as { n: number }).n;
    return n >= l.maxConcurrentRuns ? `${n} runs are going and the box allows ${l.maxConcurrentRuns} at once` : null;
  }
  private limits: EngineOptions["limits"];
  /** A one-off prompt for the next launch of a run (Resume sends a short note, not the original prompt). */
  private nextPrompt = new Map<number, string>();

  async maybeLaunch(id: number): Promise<void> {
    const run = this.getRun(id);
    if (!run || run.status !== "queued") return;
    if (this.repoBusy(run)) return;
    if (this.waitingReason()) return;
    this.setStatus(id, "starting", { started_at: run.started_at ?? now() });
    try {
      const fresh = this.getRun(id)!;
      const prompt = this.nextPrompt.get(id);
      this.nextPrompt.delete(id);
      const r = await this.launcher.start(prompt ? { ...fresh, prompt } : fresh);
      this.db
        .prepare("update runs set zellij_session = coalesce(?, zellij_session), workdir = ? where id = ?")
        .run(r.zellij_session ?? null, r.workdir, id);
      this.notifier.signal("runs", { id });
    } catch (e) {
      this.setStatus(id, "failed", { error: (e as Error).message, ended_at: now() });
    }
  }

  setStatus(id: number, status: RunStatus, extra: Partial<Pick<RunRow, "started_at" | "ended_at" | "error" | "result">> = {}): void {
    const before = this.getRun(id);
    if (!before) return;
    const cols = ["status = ?", "updated_at = ?"];
    const vals: unknown[] = [status, now()];
    for (const [k, v] of Object.entries(extra)) {
      cols.push(`${k} = ?`);
      vals.push(v);
    }
    this.db.prepare(`update runs set ${cols.join(", ")} where id = ?`).run(...vals, id);
    this.notifier.signal("runs", { id, status });
    if (before.status !== status) {
      this.emit({ source: "run", type: `run.${status}`, summary: `Run #${id} ${status}`, run_id: id, payload: { run_id: id, group: before.group_id } });
      if (SETTLED.includes(status) && before.repo) this.launchNextQueued(before.repo);
      // A slot freed up: start the oldest queued run anywhere.
      if (SETTLED.includes(status) && ACTIVE.includes(before.status)) this.launchQueued();
    }
  }

  /** Starts queued runs in order while limits allow. */
  launchQueued(): void {
    for (const { id } of this.db.prepare("select id from runs where status = 'queued' order by id").all() as { id: number }[]) {
      if (this.waitingReason()) return;
      void this.maybeLaunch(id);
    }
  }

  /**
   * Restarts an interrupted run where it was: same folder, same Claude Code session (--resume), with a
   * short note instead of the original prompt.
   */
  async resumeRun(id: number, actor: string): Promise<RunRow> {
    const run = this.getRun(id);
    if (!run) throw new Error(`no run ${id}`);
    if (!["interrupted", "stopped", "failed"].includes(run.status)) throw new Error(`run #${id} is ${run.status}; only interrupted, stopped or failed runs can be resumed`);
    if (run.mode !== "interactive") throw new Error("print-mode runs cannot be resumed; start a new run");
    if (run.zellij_session) await this.launcher.deleteSession(run).catch(() => {});
    this.db
      .prepare("update runs set status = 'queued', resume_session_id = coalesce(resume_session_id, session_id), ended_at = null, error = null, session_deleted = 0, updated_at = ? where id = ?")
      .run(now(), id);
    this.nextPrompt.set(id, "The workbench box was restarted while you were working, so this session was interrupted. Carry on from where you left off.");
    this.emit({ source: "ui-action", type: "run.resumed", summary: `${actor} resumed run #${id}`, actor, run_id: id, payload: { run_id: id } });
    await this.maybeLaunch(id);
    return this.getRun(id)!;
  }

  private launchNextQueued(repo: string): void {
    const next = this.db.prepare("select id from runs where repo = ? and status = 'queued' order by id limit 1").get(repo) as { id: number } | undefined;
    if (next) void this.maybeLaunch(next.id);
  }

  async stopRun(id: number, final: "stopped" | "done" = "stopped"): Promise<void> {
    const run = this.getRun(id);
    if (!run) throw new Error(`no run ${id}`);
    if (run.status === "queued") return this.setStatus(id, final, { ended_at: now() });
    await this.launcher.stop(run);
    if (!["done", "failed", "stopped"].includes(run.status) || final !== run.status) this.setStatus(id, final, { ended_at: run.ended_at ?? now() });
  }

  async steer(id: number, text: string, actor: string): Promise<void> {
    const run = this.getRun(id);
    if (!run) throw new Error(`no run ${id}`);
    if (run.mode !== "interactive") throw new Error("print-mode runs cannot be steered");
    await this.launcher.steer(run, text);
    this.emit({ source: "ui-action", type: "run.steered", summary: `${actor} steered: ${text.slice(0, 80)}`, actor, run_id: id, payload: { text } });
  }

  recordCost(id: number, cost: number | undefined, model?: string): void {
    if (cost == null && !model) return;
    this.db.prepare("update runs set cost_usd = coalesce(?, cost_usd), model = coalesce(?, model) where id = ?").run(cost ?? null, model ?? null, id);
    this.notifier.signal("runs", { id });
  }

  /** Called by the print-mode launcher when its process exits. */
  printFinished(id: number, r: { code: number | null; result?: string; cost?: number; error?: string }): void {
    if (r.cost != null) this.recordCost(id, r.cost);
    // Hooks (Stop, SessionEnd) usually settle the run first; the result text only arrives here.
    if (r.result) this.db.prepare("update runs set result = ? where id = ?").run(r.result, id);
    const run = this.getRun(id);
    if (!run || ["stopped", "done"].includes(run.status)) return this.notifier.signal("runs", { id });
    if (r.code === 0) this.setStatus(id, "done", { ended_at: now(), result: r.result ?? null });
    else this.setStatus(id, "failed", { ended_at: now(), error: r.error ?? `exit ${r.code}` });
  }

  /** Delete hidden sessions for runs that settled more than `hours` ago. */
  async cleanupSessions(hours: number): Promise<number[]> {
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const rows = this.db
      .prepare(
        `select * from runs where session_deleted = 0 and mode = 'interactive' and zellij_session is not null
          and status in ('idle','done','failed','stopped') and coalesce(ended_at, updated_at, created_at) <= ?`,
      )
      .all(cutoff) as RunRow[];
    const done: number[] = [];
    for (const run of rows) {
      await this.launcher.deleteSession(run);
      if (run.status === "idle") this.setStatus(run.id, "done", { ended_at: now() });
      this.db.prepare("update runs set session_deleted = 1 where id = ?").run(run.id);
      done.push(run.id);
    }
    if (done.length) this.emit({ source: "schedule", type: "sessions.cleaned", summary: `Deleted ${done.length} finished run session(s)`, payload: { runs: done } });
    return done;
  }

  // ───────────── requests ─────────────
  createRequest(input: CreateRequestInput): RequestRow {
    const group = this.group(input.group);
    const actions = input.actions?.length ? input.actions : input.mode === "guard" ? GUARD_ACTIONS : group.actions.length ? group.actions : DEFAULT_ACTIONS;
    const info = this.db
      .prepare("insert into requests (group_id, title, body, actions, mode, origin_run_id, tool) values (?,?,?,?,?,?,?)")
      .run(input.group, input.title, input.body ?? "", JSON.stringify(actions), input.mode ?? "deferred", input.origin_run_id ?? null, input.tool ? JSON.stringify(input.tool) : null);
    const req = this.getRequest(Number(info.lastInsertRowid))!;
    this.emit({
      source: input.origin_run_id ? "agent" : "ui-action",
      type: "request.created",
      summary: `Request #${req.id} raised in ${group.title}: ${req.title}`,
      run_id: input.origin_run_id ?? null,
      payload: { request_id: req.id, group: input.group, mode: req.mode },
    });
    this.notifier.signal("requests", { id: req.id, notify: group.notify, title: req.title, group: input.group });
    if (input.origin_run_id && (req.mode === "blocking" || req.mode === "guard")) this.setStatus(input.origin_run_id, "blocked");
    return req;
  }

  updateRequest(id: number, patch: { mode?: "blocking" | "deferred"; status?: "closed"; title?: string; body?: string }): RequestRow {
    const req = this.getRequest(id);
    if (!req) throw new Error(`no request ${id}`);
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cols.push(`${k} = ?`), vals.push(v));
    if (cols.length) this.db.prepare(`update requests set ${cols.join(", ")} where id = ?`).run(...vals, id);
    if (patch.mode === "deferred" && req.origin_run_id) {
      const run = this.getRun(req.origin_run_id);
      if (run?.status === "blocked") this.setStatus(run.id, "working");
    }
    this.notifier.signal("requests", { id });
    return this.getRequest(id)!;
  }

  async answerRequest(id: number, a: { action_id: string; input?: Record<string, unknown>; actor: string }): Promise<RequestRow> {
    const req = this.getRequest(id);
    if (!req) throw new Error(`no request ${id}`);
    if (req.status !== "open") throw new Error(`request ${id} is ${req.status}`);
    const actions = JSON.parse(req.actions) as RequestAction[];
    const action = actions.find((x) => x.id === a.action_id);
    if (!action) throw new Error(`unknown action ${a.action_id}`);
    const input = validateInput(action, a.input ?? {});
    const ctx = { request: { ...req, actions }, action, input, actor: a.actor };
    const prompt = action.prompt
      ? render(action.prompt, ctx)
      : `${a.actor} answered request #${id} "${req.title}" with "${action.label}".` +
        (Object.keys(input).length ? ` Input: ${JSON.stringify(input)}` : "");
    const answer: Answer = { action_id: action.id, input, actor: a.actor, at: now(), prompt };
    this.db.prepare("update requests set status = 'answered', answer = ?, answered_at = ?, answered_by = ? where id = ?").run(JSON.stringify(answer), answer.at, a.actor, id);
    const ev = this.emit({
      source: "ui-action",
      type: "request.answered",
      summary: `${a.actor} chose "${action.label}" on "${req.title}"`,
      actor: a.actor,
      run_id: req.origin_run_id,
      payload: { request_id: id, group: req.group_id, action: action.id, input },
    }).event;
    this.notifier.signal("requests", { id });

    if (req.mode === "blocking" || req.mode === "guard") {
      if (req.origin_run_id) {
        const run = this.getRun(req.origin_run_id);
        if (run?.status === "blocked") this.setStatus(run.id, "working");
      }
      this.answers.emit(String(id), this.getRequest(id));
    } else {
      await this.deliverDeferred(req, action, prompt, ev.id);
    }
    return this.getRequest(id)!;
  }

  private async deliverDeferred(req: RequestRow, action: RequestAction, prompt: string, eventId: number): Promise<void> {
    const origin = req.origin_run_id ? this.getRun(req.origin_run_id) : undefined;
    const title = `${req.title} → ${action.label}`;
    if (origin) {
      if (origin.mode === "interactive" && (await this.launcher.alive(origin))) await this.launcher.stop(origin);
      if (!["done", "failed", "stopped"].includes(origin.status)) this.setStatus(origin.id, "done", { ended_at: now() });
      this.startRun({
        group: req.group_id, prompt, title, mode: origin.mode, trigger_event_id: eventId, parent_run_id: origin.id,
        resume_session_id: origin.session_id, workdir: origin.workdir, goal: origin.goal ?? undefined,
      });
    } else {
      this.startRun({ group: req.group_id, prompt, title, trigger_event_id: eventId });
    }
  }

  /** Resolves when the request is answered, or with the still-open request after timeoutMs. */
  waitForAnswer(id: number, timeoutMs: number): Promise<RequestRow> {
    const req = this.getRequest(id);
    if (!req) return Promise.reject(new Error(`no request ${id}`));
    if (req.status !== "open") return Promise.resolve(req);
    return new Promise((resolve) => {
      const done = (r: RequestRow) => {
        clearTimeout(t);
        this.answers.off(String(id), done);
        resolve(r);
      };
      const t = setTimeout(() => done(this.getRequest(id)!), timeoutMs);
      this.answers.on(String(id), done);
    });
  }

  // ───────────── Claude Code hooks ─────────────
  async hook(runId: number, name: string, p: Record<string, any>): Promise<Record<string, unknown>> {
    const run = this.getRun(runId);
    if (!run) return {};
    this.emit({ source: "hook", type: `hook.${name}`, summary: hookSummary(name, p), run_id: runId, payload: trimHookPayload(p) });
    if (p.session_id && p.session_id !== run.session_id) this.db.prepare("update runs set session_id = ? where id = ?").run(p.session_id, runId);
    const terminal = ["done", "failed", "stopped"].includes(run.status);

    switch (name) {
      case "SessionStart":
      case "UserPromptSubmit":
        if (!terminal) this.setStatus(runId, "working");
        return {};
      case "PreToolUse": {
        const group = this.config.get().groups[run.group_id];
        const pattern = group ? firstGuardMatch(group.guard, p.tool_name, p.tool_input) : null;
        if (!pattern) {
          if (run.status !== "working" && !terminal) this.setStatus(runId, "working");
          return {};
        }
        const subject = toolSubject(p.tool_name, p.tool_input);
        const req = this.createRequest({
          group: run.group_id,
          title: `Allow ${p.tool_name}: ${subject.slice(0, 80)}`,
          body: `Run #${runId} wants to call a guarded tool.\n\n**Tool:** \`${p.tool_name}\`\n\n**Matched guard:** \`${pattern}\`\n\n\`\`\`json\n${JSON.stringify(p.tool_input, null, 2)}\n\`\`\``,
          mode: "guard",
          origin_run_id: runId,
          tool: { name: p.tool_name, input: p.tool_input, pattern },
        });
        return { pending: req.id };
      }
      case "Notification":
        if (/waiting for your input/i.test(String(p.message ?? "")) && !terminal) this.setStatus(runId, "idle");
        return {};
      case "Stop": {
        if (run.goal && !terminal) {
          const cwd = run.workdir ?? process.cwd();
          const check = await this.runGoal(run.goal, cwd);
          if (check.ok) {
            this.emit({ source: "run", type: "goal.met", summary: `Goal met: ${run.goal}`, run_id: runId, payload: { goal: run.goal, iterations: run.goal_iterations } });
            this.setStatus(runId, "done", { ended_at: now(), result: `goal met after ${run.goal_iterations} retries` });
            return {};
          }
          if (run.goal_iterations < this.goalMaxIterations) {
            this.db.prepare("update runs set goal_iterations = goal_iterations + 1 where id = ?").run(runId);
            this.emit({ source: "run", type: "goal.retry", summary: `Goal not met (${run.goal_iterations + 1}/${this.goalMaxIterations}), continuing`, run_id: runId, payload: { goal: run.goal, output: check.output } });
            return {
              decision: "block",
              reason: `The goal check \`${run.goal}\` has not passed yet. Output:\n${check.output.slice(-800) || "(no output)"}\nKeep working toward the goal, then finish your turn.`,
            };
          }
          this.setStatus(runId, "failed", { ended_at: now(), error: `goal not met after ${run.goal_iterations} retries` });
          return {};
        }
        if (!terminal) this.setStatus(runId, "idle", { ended_at: now() });
        return {};
      }
      case "SessionEnd":
        if (!terminal) this.setStatus(runId, run.status === "failed" ? "failed" : "done", { ended_at: run.ended_at ?? now() });
        return {};
      default:
        return {};
    }
  }

  /** Converts a guard answer into the PreToolUse hook output. */
  guardDecision(req: RequestRow): Record<string, unknown> | null {
    if (req.status !== "answered" || !req.answer) return null;
    const a = JSON.parse(req.answer) as Answer;
    const allow = a.action_id === "allow";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: allow ? "allow" : "deny",
        permissionDecisionReason: allow ? `Approved by ${a.actor}` : `Denied by ${a.actor}${a.input.reason ? `: ${a.input.reason}` : ""}`,
      },
    };
  }
}

function validateInput(action: RequestAction, input: Record<string, unknown>): Record<string, unknown> {
  const spec = (action.input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, t] of Object.entries(spec)) {
    const v = input[k];
    if (v === undefined || v === "") continue;
    if (t === "number") {
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`${k} must be a number`);
      out[k] = n;
    } else if (t === "boolean") out[k] = v === true || v === "true";
    else if (t && typeof t === "object" && Array.isArray((t as { enum?: string[] }).enum)) {
      if (!(t as { enum: string[] }).enum.includes(String(v))) throw new Error(`${k} must be one of ${(t as { enum: string[] }).enum.join(", ")}`);
      out[k] = String(v);
    } else out[k] = String(v);
  }
  return out;
}

export function hookSummary(name: string, p: Record<string, any>): string {
  switch (name) {
    case "PreToolUse":
      return `${p.tool_name}: ${toolSubject(p.tool_name, p.tool_input).slice(0, 140)}`;
    case "PostToolUse": {
      const r = p.tool_response;
      const text = typeof r === "string" ? r : r?.stdout ?? r?.content ?? (r ? JSON.stringify(r) : "");
      return `${p.tool_name} → ${String(text).replace(/\s+/g, " ").slice(0, 140)}`;
    }
    case "UserPromptSubmit":
      return `Prompt: ${String(p.prompt ?? "").slice(0, 160)}`;
    case "Notification":
      return String(p.message ?? "notification");
    case "Stop":
      return p.stop_hook_active ? "Turn finished (after goal retry)" : "Turn finished";
    case "SessionStart":
      return `Session ${p.source ?? "started"}`;
    case "SessionEnd":
      return `Session ended${p.reason ? ` (${p.reason})` : ""}`;
    default:
      return name;
  }
}

function trimHookPayload(p: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  const r = out.tool_response;
  if (r !== undefined) {
    const s = typeof r === "string" ? r : JSON.stringify(r);
    out.tool_response = s.length > 4000 ? s.slice(0, 4000) + "…" : r;
  }
  return out;
}

function defaultRunGoal(goal: string, cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile("sh", ["-c", goal], { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}${stderr}`.trim() });
    });
  });
}
