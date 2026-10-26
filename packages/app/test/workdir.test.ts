import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunSpec } from "../src/engine/runspec.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "wb-run-"));
const skill = (base: string, name: string, desc: string) => {
  mkdirSync(join(base, name), { recursive: true });
  writeFileSync(join(base, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n`);
};
const group = (extra: Record<string, unknown> = {}) =>
  ({ title: "x", autonomy: "autonomous", actions: [], guard: [], allowedTools: [], mcpServers: {}, parallel: false, notify: [], extraSkillDirs: [], pluginDirs: [], addDirs: [], webAccess: true, ...extra }) as any;
const run = (id: number, workdir: string | null = null) => ({ id, prompt: "p", group_id: "x", mode: "interactive", workdir, session_id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}` }) as any;

function env(dir: string) {
  const workspace = join(dir, "workspace");
  const skills = join(workspace, ".claude/skills");
  skill(skills, "triage", "workspace triage");
  return { workspace, skills, e: { runsDir: join(dir, "runs"), workDir: join(dir, "work"), skillsDir: skills, workspaceDir: workspace, hooksDir: "/h", mcpServer: "/m.ts", localApiUrl: "http://x", claudeBin: "claude", extraPath: [] } };
}

describe("where runs work", () => {
  it("gives each run a fresh folder of its own with the workflow's skills, by default", () => {
    const dir = tmp();
    const { e } = env(dir);
    const spec = buildRunSpec(run(1), "x", group(), e, false);
    expect(spec.workdir).toBe(join(dir, "runs/1/work"));
    expect(readFileSync(join(spec.workdir, ".claude/skills/triage/SKILL.md"), "utf8")).toContain("workspace triage");
    expect(readFileSync(spec.script, "utf8")).not.toContain("--add-dir");
  });

  it("starts runs in a folder the workflow names and writes nothing into it; skills arrive through --add-dir", () => {
    const dir = tmp();
    const { e, workspace } = env(dir);
    const code = join(dir, "code/shop");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, "README.md"), "shop\n");
    skill(join(dir, "shared"), "deploy", "shared deploy");
    mkdirSync(join(workspace, "plugins/ours"), { recursive: true });
    mkdirSync(join(dir, "other"));
    const spec = buildRunSpec(run(2), "x", group({ workdir: code, extraSkillDirs: [join(dir, "shared")], pluginDirs: ["plugins/ours", "plugins/missing"], addDirs: [join(dir, "other"), join(dir, "nope")] }), e, false);
    expect(spec.workdir).toBe(code);
    expect(readdirSync(code)).toEqual(["README.md"]);
    const script = readFileSync(spec.script, "utf8");
    expect(script).toContain(`cd '${code}'`);
    const skillHome = join(dir, "runs/2/skills");
    expect(script).toContain(`--add-dir '${skillHome}'`);
    expect(script).toContain(`--add-dir '${join(dir, "other")}'`);
    expect(script).not.toContain("nope");
    expect(readFileSync(join(skillHome, ".claude/skills/triage/SKILL.md"), "utf8")).toContain("workspace triage");
    expect(readFileSync(join(skillHome, ".claude/skills/deploy/SKILL.md"), "utf8")).toContain("shared deploy");
    expect(script).toContain(`--plugin-dir '${join(workspace, "plugins/ours")}'`);
    expect(script).not.toContain("plugins/missing");
  });

  it("resolves a working folder relative to the workspace, and a resumed run keeps its folder", () => {
    const dir = tmp();
    const { e, workspace } = env(dir);
    const spec = buildRunSpec(run(3), "x", group({ workdir: "scratch" }), e, false);
    expect(spec.workdir).toBe(join(workspace, "scratch"));
    expect(existsSync(spec.workdir)).toBe(true);
    const again = buildRunSpec(run(3, join(dir, "kept")), "x", group({ workdir: "scratch" }), e, false);
    expect(again.workdir).toBe(join(dir, "kept"));
  });
});

describe("web access", () => {
  it("is off for a workflow that turns it off", () => {
    const dir = tmp();
    const { e } = env(dir);
    const spec = buildRunSpec(run(10), "x", group({ webAccess: false }), e, false);
    const perms = JSON.parse(readFileSync(join(spec.dir, "settings.json"), "utf8")).permissions;
    expect(perms.allow).not.toEqual(expect.arrayContaining(["WebSearch"]));
    expect(perms.deny).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
  });

  it("lets every run search and fetch the web, and still denies the box's own credentials", () => {
    const dir = tmp();
    const { e } = env(dir);
    const spec = buildRunSpec(run(9), "x", group(), { ...e, secretsFile: join(dir, "secrets.json"), adminTokenFile: join(dir, "admin.token") }, false);
    const perms = JSON.parse(readFileSync(join(spec.dir, "settings.json"), "utf8")).permissions;
    expect(perms.allow).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
    expect(perms.deny).not.toEqual(expect.arrayContaining(["WebSearch"]));
    expect(perms.deny).not.toEqual(expect.arrayContaining(["WebFetch"]));
    expect(perms.deny).toEqual(expect.arrayContaining([`Read(/${join(dir, "secrets.json")})`, `Read(/${join(dir, "admin.token")})`]));
  });
});
