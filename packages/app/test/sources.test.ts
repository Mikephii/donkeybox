import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/engine/config.ts";
import { firstGuardMatch, matchesGuard } from "../src/engine/guard.ts";
import { findSourceByPath, normalize, verify } from "../src/engine/sources.ts";
import { render } from "../src/engine/template.ts";
import { baseConfig } from "./helpers.ts";

const cfg = (parseConfig(baseConfig) as any).config;
const secrets = (n: string) => ({ GH_SECRET: "s3cret", DEPLOY_SECRET: "d3ploy" })[n];

describe("verifiers", () => {
  const body = Buffer.from(JSON.stringify({ action: "closed" }));
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts a correct GitHub signature and rejects anything else", () => {
    expect(verify(cfg.sources.github, { headers: { "x-hub-signature-256": sig }, rawBody: body, body: null }, secrets)).toBeNull();
    expect(verify(cfg.sources.github, { headers: { "x-hub-signature-256": sig.replace(/.$/, "0") }, rawBody: body, body: null }, secrets)).toBe("bad signature");
    expect(verify(cfg.sources.github, { headers: {}, rawBody: body, body: null }, secrets)).toMatch(/missing/);
    expect(verify(cfg.sources.github, { headers: { "x-hub-signature-256": sig }, rawBody: body, body: null }, () => undefined)).toMatch(/not set/);
  });
  it("checks header secrets", () => {
    expect(verify(cfg.sources.deploy, { headers: { "x-hook-secret": "d3ploy" }, rawBody: body, body: null }, secrets)).toBeNull();
    expect(verify(cfg.sources.deploy, { headers: { "x-hook-secret": "nope" }, rawBody: body, body: null }, secrets)).toBe("bad secret");
  });
});

describe("url-token, configurable hmac, none and generic", () => {
  const src = (o: Record<string, unknown>) => (parseConfig({ ...baseConfig, sources: { x: o } }) as any).config.sources.x;
  const body = Buffer.from('{"a":1}');
  it("url-token: the secret is the last path segment, compared in constant time, and the base path finds the source", () => {
    const s = src({ path: "/hooks/jira", verify: { kind: "url-token", secret: "JT" }, adapter: "jira" });
    const sec = (n: string) => (n === "JT" ? "tok-abc" : undefined);
    expect(verify(s, { headers: {}, rawBody: body, body: null, path: "/hooks/jira/tok-abc" }, sec)).toBeNull();
    expect(verify(s, { headers: {}, rawBody: body, body: null, path: "/hooks/jira/tok-abc?x=1" }, sec)).toBeNull();
    expect(verify(s, { headers: {}, rawBody: body, body: null, path: "/hooks/jira/tok-abd" }, sec)).toBe("bad URL token");
    expect(verify(s, { headers: {}, rawBody: body, body: null, path: "/hooks/jira" }, sec)).toBe("bad URL token");
    const sources = { jira: s, other: src({ path: "/hooks/jira-two", verify: { kind: "none" }, map: { type: "t.x" } }) };
    expect(findSourceByPath(sources, "/hooks/jira/tok-abc")?.[0]).toBe("jira");
    expect(findSourceByPath(sources, "/hooks/jira/tok/extra")).toBeNull();
    expect(findSourceByPath(sources, "/hooks/jira-two")?.[0]).toBe("other");
  });
  it("hmac: header, algorithm and prefix are configurable; GitHub's are the default", () => {
    const s = src({ path: "/hooks/x", verify: { kind: "hmac", secret: "K", header: "X-Signature", algorithm: "sha1", prefix: "" }, map: { type: "t.x" } });
    const sig = createHmac("sha1", "k1").update(body).digest("hex");
    expect(verify(s, { headers: { "x-signature": sig }, rawBody: body, body: null }, () => "k1")).toBeNull();
    expect(verify(s, { headers: { "x-signature": "sha1=" + sig }, rawBody: body, body: null }, () => "k1")).toBe("bad signature");
    expect(src({ path: "/hooks/y", verify: { kind: "hmac", secret: "K" }, adapter: "github" }).verify).toEqual({ kind: "hmac", secret: "K", header: "x-hub-signature-256", algorithm: "sha256", prefix: "sha256=" });
  });
  it("none accepts anything; it needs no secret", () => {
    expect(verify(src({ path: "/hooks/open", verify: { kind: "none" }, map: { type: "t.x" } }), { headers: {}, rawBody: body, body: null }, () => undefined)).toBeNull();
  });
  it("generic takes {type, summary, payload, actor} as sent, works with any verifier, and refuses an adapter or map", () => {
    for (const verifyKind of [{ kind: "header", header: "X-Token", secret: "T" }, { kind: "url-token", secret: "T" }, { kind: "hmac", secret: "T" }, { kind: "none" }]) {
      const s = src({ kind: "generic", path: "/hooks/ci", verify: verifyKind });
      expect(normalize(s, { headers: {}, rawBody: body, body: { type: "ci.build.failed", summary: "main is red", payload: { sha: "abc" }, actor: "ci-bot" } })).toEqual({ type: "ci.build.failed", summary: "main is red", payload: { sha: "abc" }, actor: "ci-bot" });
    }
    const g = src({ kind: "generic", path: "/hooks/ci", verify: { kind: "none" } });
    expect(normalize(g, { headers: {}, rawBody: body, body: { summary: "no type" } })).toBeNull();
    expect(normalize(g, { headers: {}, rawBody: body, body: { type: "bad type!" } })).toBeNull();
    const bad = parseConfig({ ...baseConfig, sources: { x: { kind: "generic", path: "/hooks/x", verify: { kind: "none" }, adapter: "github" } } }) as any;
    expect(bad.ok).toBe(false);
  });
});

describe("adapters and maps", () => {
  it("names a merged PR github.pull_request.merged and trims the payload", () => {
    const ev = normalize(cfg.sources.github, {
      headers: { "x-github-event": "pull_request" },
      rawBody: Buffer.alloc(0),
      body: { action: "closed", pull_request: { number: 9, title: "Fix", merged: true, user: { login: "o" }, head: { ref: "f" }, base: { ref: "main" } }, repository: { full_name: "a/b" }, sender: { login: "o" } },
    })!;
    expect(ev.type).toBe("github.pull_request.merged");
    expect(ev.payload).toMatchObject({ repo: "a/b", number: 9, title: "Fix", author: "o", branch: "f" });
    expect(ev.summary).toBe("PR #9 merged: Fix (a/b)");
  });
  it("keeps closed-unmerged PRs distinct", () => {
    const ev = normalize(cfg.sources.github, { headers: { "x-github-event": "pull_request" }, rawBody: Buffer.alloc(0), body: { action: "closed", pull_request: { number: 9, merged: false } } })!;
    expect(ev.type).toBe("github.pull_request.closed");
  });
  it("ignores GitHub pings", () => {
    expect(normalize(cfg.sources.github, { headers: { "x-github-event": "ping" }, rawBody: Buffer.alloc(0), body: {} })).toBeNull();
  });
  it("maps Jira webhookEvent names", () => {
    const jira = (parseConfig({ ...baseConfig, sources: { jira: { path: "/hooks/jira", verify: { kind: "none" }, adapter: "jira" } } }) as any).config.sources.jira;
    const ev = normalize(jira, { headers: {}, rawBody: Buffer.alloc(0), body: { webhookEvent: "jira:issue_created", issue: { key: "SHOP-1", fields: { summary: "Bug", status: { name: "To Do" }, project: { key: "SHOP" } } } } })!;
    expect(ev.type).toBe("jira.issue.created");
    expect(ev.payload).toMatchObject({ key: "SHOP-1", summary: "Bug", status: "To Do", project: "SHOP" });
  });
  it("applies declarative maps", () => {
    const ev = normalize(cfg.sources.deploy, { headers: {}, rawBody: Buffer.alloc(0), body: { environment: "prod", commit: "abc" } })!;
    expect(ev).toEqual({ type: "deploy.finished", summary: "Deployed abc", payload: { env: "prod", sha: "abc" } });
  });
  it("finds sources by path", () => {
    expect(findSourceByPath(cfg.sources, "/hooks/github?x=1")?.[0]).toBe("github");
    expect(findSourceByPath(cfg.sources, "/hooks/nope")).toBeNull();
  });
});

describe("guard patterns", () => {
  it("matches Claude Code permission-rule syntax", () => {
    expect(matchesGuard("Bash(jira delete*)", "Bash", { command: "jira delete DEMO-2" })).toBe(true);
    expect(matchesGuard("Bash(jira delete*)", "Bash", { command: "jira list" })).toBe(false);
    expect(matchesGuard("Bash(jira:*)", "Bash", { command: "jira anything" })).toBe(true);
    expect(matchesGuard("mcp__jira__*", "mcp__jira__delete_issue", {})).toBe(true);
    expect(matchesGuard("Write(/etc/**)", "Write", { file_path: "/etc/hosts" })).toBe(true);
    expect(matchesGuard("Write(/etc/**)", "Edit", { file_path: "/etc/hosts" })).toBe(false);
    expect(firstGuardMatch(["Bash(rm *)", "Bash(jira delete*)"], "Bash", { command: "jira delete X" })).toBe("Bash(jira delete*)");
  });
});

describe("config validation", () => {
  it("rejects rules pointing at unknown groups and sources without a verifier", () => {
    const bad = structuredClone(baseConfig) as any;
    bad.rules[0].group = "missing";
    bad.sources.broken = { path: "/hooks/broken", adapter: "github" };
    const r = parseConfig(bad);
    expect(r.ok).toBe(false);
    expect((r as any).errors.join("\n")).toMatch(/unknown group missing/);
    expect((r as any).errors.join("\n")).toMatch(/need a verifier/);
  });
  it("accepts schedules without paths", () => {
    expect(parseConfig({ ...baseConfig, sources: { nightly: { schedule: "0 2 * * *", type: "schedule.nightly" } } }).ok).toBe(true);
  });
});

describe("templates", () => {
  it("renders nested paths, blanks missing values and JSON-encodes objects", () => {
    expect(render("/x {{payload.pr.number}} {{missing.y}} {{input}}", { payload: { pr: { number: 3 } }, input: { a: 1 } })).toBe('/x 3  {"a":1}');
  });
});

describe("published schema", () => {
  it("schema/config.schema.json is current (run pnpm schema after changing the config schema)", async () => {
    const { readFileSync } = await import("node:fs");
    const { schemaText } = await import("../src/schema.ts");
    expect(readFileSync(new URL("../../../schema/config.schema.json", import.meta.url), "utf8")).toBe(schemaText());
  });
});
