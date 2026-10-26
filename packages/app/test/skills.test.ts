import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frontmatter, SkillStore, starterSkill } from "../src/lib/skills.ts";
import { sampleDelivery, sourceFeedsRule } from "../src/lib/workflows.ts";

describe("skill store", () => {
  it("starter skills pass its own validation", () => {
    const s = new SkillStore(mkdtempSync(join(tmpdir(), "wb-sk-")));
    s.write("email-jeff", starterSkill("email-jeff", "Email Jeff"));
    expect(frontmatter(s.read("email-jeff"))).toMatchObject({ name: "email-jeff" });
    expect(s.list()[0]).toMatchObject({ name: "email-jeff" });
  });
});

describe("source helpers", () => {
  it("knows which rules a source can feed", () => {
    const gh = { path: "/hooks/github", verify: { kind: "none" as const }, adapter: "github" as const };
    const rule = (on: string) => ({ id: "r", on, filter: {}, prompt: "", group: "g", mode: "interactive" as const, enabled: true });
    expect(sourceFeedsRule(gh, rule("github.pull_request.merged"))).toBe(true);
    expect(sourceFeedsRule(gh, rule("jira.issue.created"))).toBe(false);
    expect(sourceFeedsRule(gh, rule("*.merged"))).toBe(true);
    const sched = { schedule: "* * * * *", type: "schedule.nightly" };
    expect(sourceFeedsRule(sched, rule("schedule.*"))).toBe(true);
  });
  it("builds sample bodies that contain every mapped path", () => {
    const s = { path: "/hooks/x", verify: { kind: "none" as const }, map: { type: "x", payload: { env: "$.deploy.env", sha: "$.commit" } } };
    expect(sampleDelivery("x", s).body).toEqual({ deploy: { env: "sample-env" }, commit: "sample-sha" });
  });
});

describe("skills folder from settings", () => {
  it("reads and writes wherever settings.skillsDir points, with the same checks", async () => {
    const { mkdtempSync, existsSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { SkillStore } = await import("../src/lib/skills.ts");
    const ws = mkdtempSync(join(tmpdir(), "wb-ws-"));
    let dir = ".claude/skills";
    const store = new SkillStore(() => join(ws, dir));
    store.write("alpha", "---\nname: alpha\ndescription: first\n---\nbody");
    expect(existsSync(join(ws, ".claude/skills/alpha/SKILL.md"))).toBe(true);
    dir = "team-skills";
    store.write("beta", "---\nname: beta\ndescription: second\n---\nbody");
    expect(readFileSync(join(ws, "team-skills/beta/SKILL.md"), "utf8")).toContain("name: beta");
    expect(() => store.write("gamma", "no frontmatter")).toThrow();
    expect(() => store.write("../escape", "---\nname: x\ndescription: y\n---\n")).toThrow();
    expect(store.list().map((s: any) => s.name)).toEqual(["beta"]);
  });
});
