import { describe, expect, it } from "vitest";
import { matchesRule } from "../src/engine/engine.ts";
import { setup, tick } from "./helpers.ts";

describe("event to rule to run", () => {
  it("starts a run with the rendered prompt and title when a rule matches", async () => {
    const { engine, launcher } = setup();
    const r = engine.emit({ source: "webhook:github", type: "github.pull_request.merged", summary: "PR #7 merged", payload: { repo: "example/shop", number: 7 } });
    expect(r.runs).toHaveLength(1);
    const run = r.runs[0]!;
    expect(run.prompt).toBe("/house post-merge example/shop #7");
    expect(run.title).toBe("PR #7");
    expect(run.trigger_event_id).toBe(r.event.id);
    expect(run.rule_id).toBe("merged");
    await tick();
    expect(launcher.started.map((x) => x.id)).toEqual([run.id]);
    expect(engine.getRun(run.id)!.status).toBe("starting");
  });

  it("applies payload filters and glob event types", () => {
    const { engine } = setup();
    expect(engine.emit({ source: "x", type: "github.push", payload: { repo: "other/repo" } }).runs).toHaveLength(0);
    expect(engine.emit({ source: "x", type: "github.push", payload: { repo: "example/shop" } }).runs).toHaveLength(1);
    const d = engine.emit({ source: "x", type: "deploy.finished", payload: { env: "prod" } });
    expect(d.runs[0]!.mode).toBe("print");
    expect(d.runs[0]!.prompt).toBe("/house deploy prod");
  });

  it("dedupes deliveries so a retried webhook never runs twice", () => {
    const { engine } = setup();
    const a = engine.emit({ source: "x", type: "github.pull_request.merged", payload: { number: 1 }, dedupe_key: "github:abc" });
    const b = engine.emit({ source: "x", type: "github.pull_request.merged", payload: { number: 1 }, dedupe_key: "github:abc" });
    expect(a.runs).toHaveLength(1);
    expect(b.duplicate).toBe(true);
    expect(b.runs).toHaveLength(0);
    expect(b.event.id).toBe(a.event.id);
  });

  it("never triggers rules from hook chatter", () => {
    const { engine } = setup();
    expect(engine.emit({ source: "hook", type: "github.pull_request.merged", payload: {} }).runs).toHaveLength(0);
  });

  it("matchesRule handles arrays and string globs in filters", () => {
    const rule = { id: "r", on: "jira.issue.*", filter: { project: ["SHOP", "OPS"], key: "SHOP-*" }, prompt: "", group: "g", mode: "interactive" as const, enabled: true };
    expect(matchesRule(rule, "jira.issue.created", { project: "SHOP", key: "SHOP-12" })).toBe(true);
    expect(matchesRule(rule, "jira.issue.created", { project: "WEB", key: "SHOP-12" })).toBe(false);
    expect(matchesRule(rule, "jira.comment.created", { project: "SHOP", key: "SHOP-12" })).toBe(false);
    expect(matchesRule({ ...rule, enabled: false }, "jira.issue.created", { project: "SHOP", key: "SHOP-1" })).toBe(false);
  });

  it("queues runs that share a working folder and starts the next one when the first settles", async () => {
    const { engine, launcher } = setup();
    const a = engine.startRun({ group: "repo", prompt: "a" });
    const b = engine.startRun({ group: "repo", prompt: "b" });
    await tick();
    expect(engine.getRun(a.id)!.status).toBe("starting");
    expect(engine.getRun(b.id)!.status).toBe("queued");
    await engine.hook(a.id, "Stop", {});
    await tick();
    expect(engine.getRun(a.id)!.status).toBe("idle");
    expect(launcher.started.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("emits run status events that rules can chain on", async () => {
    const cfg = structuredClone((await import("./helpers.ts")).baseConfig) as any;
    cfg.rules.push({ id: "after", on: "run.idle", prompt: "/house follow-up {{payload.run_id}}", group: "house" });
    const { engine } = setup(cfg);
    const first = engine.startRun({ group: "house", prompt: "x" });
    await tick();
    await engine.hook(first.id, "Stop", {});
    const follow = engine.db.prepare("select * from runs where rule_id = 'after'").get() as any;
    expect(follow.prompt).toBe(`/house follow-up ${first.id}`);
  });
});

describe("answer delivery", () => {
  it("blocking: wakes the waiter and puts the run back to working", async () => {
    const { engine } = setup();
    const run = engine.startRun({ group: "jira", prompt: "x" });
    await tick();
    const req = engine.createRequest({ group: "jira", title: "Create 2 tickets?", mode: "blocking", origin_run_id: run.id });
    expect(engine.getRun(run.id)!.status).toBe("blocked");
    const waiting = engine.waitForAnswer(req.id, 2000);
    await engine.answerRequest(req.id, { action_id: "changes", input: { note: "only one" }, actor: "alice@x" });
    const answered = await waiting;
    expect(answered.status).toBe("answered");
    const ans = JSON.parse(answered.answer!);
    expect(ans).toMatchObject({ action_id: "changes", actor: "alice@x", input: { note: "only one" }, prompt: `/jira changes ${req.id}: only one` });
    expect(engine.getRun(run.id)!.status).toBe("working");
  });

  it("waitForAnswer returns the open request on timeout", async () => {
    const { engine } = setup();
    const req = engine.createRequest({ group: "jira", title: "t", mode: "blocking" });
    const r = await engine.waitForAnswer(req.id, 20);
    expect(r.status).toBe("open");
  });

  it("deferred: stops the origin session and resumes its conversation in a new run", async () => {
    const { engine, launcher } = setup();
    const origin = engine.startRun({ group: "jira", prompt: "/jira plan" });
    await tick();
    const req = engine.createRequest({ group: "jira", title: "Plan", mode: "deferred", origin_run_id: origin.id });
    expect(engine.getRun(origin.id)!.status).toBe("starting"); // deferred does not block
    await engine.answerRequest(req.id, { action_id: "approve", actor: "bob@x" });
    await tick();
    expect(launcher.stopped).toContain(origin.id);
    expect(engine.getRun(origin.id)!.status).toBe("done");
    const next = engine.db.prepare("select * from runs where parent_run_id = ?").get(origin.id) as any;
    expect(next.prompt).toBe(`/jira approved ${req.id}`);
    expect(next.resume_session_id).toBe(origin.session_id);
    expect(next.session_id).toBe(origin.session_id);
    expect(next.workdir).toBe(engine.getRun(origin.id)!.workdir);
  });

  it("deferred without an origin run starts a fresh run in the group", async () => {
    const { engine } = setup();
    const req = engine.createRequest({ group: "jira", title: "Human-raised", mode: "deferred" });
    await engine.answerRequest(req.id, { action_id: "approve", actor: "bob@x" });
    const next = engine.db.prepare("select * from runs order by id desc").get() as any;
    expect(next.group_id).toBe("jira");
    expect(next.resume_session_id).toBeNull();
  });

  it("uses the group's default actions and validates input", async () => {
    const { engine } = setup();
    const req = engine.createRequest({ group: "jira", title: "t" });
    expect(JSON.parse(req.actions).map((a: any) => a.id)).toEqual(["approve", "changes"]);
    await expect(engine.answerRequest(req.id, { action_id: "nope", actor: "a" })).rejects.toThrow(/unknown action/);
    await engine.answerRequest(req.id, { action_id: "approve", actor: "a" });
    await expect(engine.answerRequest(req.id, { action_id: "approve", actor: "a" })).rejects.toThrow(/answered/);
  });

  it("emits request.answered with the actor so the history shows who decided", async () => {
    const { engine } = setup();
    const req = engine.createRequest({ group: "house", title: "t" });
    await engine.answerRequest(req.id, { action_id: "approve", actor: "carol@x" });
    const ev = engine.db.prepare("select * from events where type = 'request.answered'").get() as any;
    expect(ev.actor).toBe("carol@x");
    expect(ev.summary).toContain("carol@x");
  });
});

describe("guards", () => {
  it("pauses a matching tool call on a guard request and converts the answer to a hook decision", async () => {
    const { engine } = setup();
    const run = engine.startRun({ group: "jira", prompt: "x" });
    await tick();
    const out = await engine.hook(run.id, "PreToolUse", { tool_name: "Bash", tool_input: { command: "jira delete DEMO-2" } });
    expect(out).toHaveProperty("pending");
    const req = engine.getRequest((out as any).pending)!;
    expect(req.mode).toBe("guard");
    expect(engine.getRun(run.id)!.status).toBe("blocked");
    await engine.answerRequest(req.id, { action_id: "deny", input: { reason: "keep it" }, actor: "alice@x" });
    expect(engine.guardDecision(engine.getRequest(req.id)!)).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Denied by alice@x: keep it" },
    });
  });

  it("lets non-matching tool calls through without a request", async () => {
    const { engine } = setup();
    const run = engine.startRun({ group: "jira", prompt: "x" });
    await tick();
    expect(await engine.hook(run.id, "PreToolUse", { tool_name: "Bash", tool_input: { command: "jira list" } })).toEqual({});
    expect(await engine.hook(run.id, "PreToolUse", { tool_name: "mcp__jira__create_issue", tool_input: {} })).toEqual({});
    expect(engine.db.prepare("select count(*) n from requests").get()).toEqual({ n: 0 });
  });
});

describe("goal loop", () => {
  it("blocks Stop until the goal passes, then marks the run done", async () => {
    let passes = 0;
    const { engine } = setup(undefined, { goal: () => ({ ok: ++passes >= 2, output: `count ${passes}` }) });
    const run = engine.startRun({ group: "house", prompt: "count", goal: "test -f done" });
    await tick();
    const first = await engine.hook(run.id, "Stop", {});
    expect(first).toMatchObject({ decision: "block" });
    expect((first as any).reason).toContain("count 1");
    expect(await engine.hook(run.id, "Stop", { stop_hook_active: true })).toEqual({});
    expect(engine.getRun(run.id)!.status).toBe("done");
  });

  it("gives up after the iteration limit", async () => {
    const { engine } = setup(undefined, { goal: () => ({ ok: false, output: "" }) });
    const run = engine.startRun({ group: "house", prompt: "x", goal: "false" });
    await tick();
    await engine.hook(run.id, "Stop", {});
    await engine.hook(run.id, "Stop", {});
    expect(await engine.hook(run.id, "Stop", {})).toEqual({});
    expect(engine.getRun(run.id)!.status).toBe("failed");
  });
});

describe("run control", () => {
  it("steers, stops and cleans up hidden sessions", async () => {
    const { engine, launcher } = setup();
    const run = engine.startRun({ group: "house", prompt: "x" });
    await tick();
    await engine.steer(run.id, "also do y", "alice@x");
    expect(launcher.steered).toEqual([{ id: run.id, text: "also do y" }]);
    await engine.hook(run.id, "Stop", {});
    expect(await engine.cleanupSessions(0)).toEqual([run.id]);
    expect(launcher.deleted).toEqual([run.id]);
    expect(engine.getRun(run.id)!.status).toBe("done");
    expect(await engine.cleanupSessions(0)).toEqual([]);
  });

  it("records print-mode results even after hooks settled the run", async () => {
    const { engine } = setup();
    const run = engine.startRun({ group: "house", prompt: "x", mode: "print" });
    await tick();
    await engine.hook(run.id, "SessionEnd", {});
    engine.printFinished(run.id, { code: 0, result: "all good", cost: 0.01 });
    expect(engine.getRun(run.id)).toMatchObject({ status: "done", result: "all good", cost_usd: 0.01 });
  });
});

describe("limits and sleep/wake", () => {
  it("keeps runs queued past maxConcurrentRuns and starts the next when a slot frees", async () => {
    const t = setup();
    let max = 1;
    let blocked: string | null = null;
    (t.engine as any).limits = () => ({ maxConcurrentRuns: max, blocked });
    const a = t.engine.startRun({ group: "house", prompt: "a" });
    const b = t.engine.startRun({ group: "house", prompt: "b" });
    await tick();
    expect(t.engine.getRun(a.id)!.status).toBe("starting");
    expect(t.engine.getRun(b.id)!.status).toBe("queued");
    expect(t.engine.waitingReason()).toMatch(/allows 1 at once/);
    t.engine.setStatus(a.id, "working");
    t.engine.setStatus(a.id, "done");
    await tick();
    expect(t.engine.getRun(b.id)!.status).toBe("starting");
    // A hard stop (disk full) holds everything back.
    max = 9;
    blocked = "the data disk is 97% full";
    const c = t.engine.startRun({ group: "house", prompt: "c" });
    await tick();
    expect(t.engine.getRun(c.id)!.status).toBe("queued");
    expect(t.engine.waitingReason()).toMatch(/97% full/);
  });

  it("resumes an interrupted run in the same folder and session with a short note", async () => {
    const t = setup();
    const r = t.engine.startRun({ group: "house", prompt: "the original task" });
    await tick();
    t.engine.setStatus(r.id, "interrupted", { error: "the box stopped" });
    const before = t.engine.getRun(r.id)!;
    await t.engine.resumeRun(r.id, "dev@localhost");
    const relaunched = t.launcher.started.at(-1)!;
    expect(relaunched.id).toBe(r.id);
    expect(relaunched.resume_session_id).toBe(before.session_id);
    expect(relaunched.workdir).toBe(before.workdir);
    expect(relaunched.prompt).toMatch(/restarted while you were working/);
    expect(t.engine.getRun(r.id)!.prompt).toBe("the original task");
    expect(t.engine.getRun(r.id)!.error).toBeNull();
    const done = t.engine.startRun({ group: "house", prompt: "x" });
    await tick();
    t.engine.setStatus(done.id, "done");
    await expect(t.engine.resumeRun(done.id, "x")).rejects.toThrow(/only interrupted/);
  });
});
