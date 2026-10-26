import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carryUnknown, ConfigStore, parseValidParts } from "../src/engine/config.ts";
import { Admin } from "../src/lib/admin.ts";
import { SkillStore } from "../src/lib/skills.ts";

// A config.json as a newer build might write it: every level carries something this build does not know.
const NEWER = {
  $schema: "./.workbench/config.schema.json",
  future: { dashboards: ["ops"] },
  settings: {
    box: { id: "box_1", name: "Acme", colour: "teal" },
    retentionPolicy: "90d",
    limits: { maxConcurrentRuns: 3, maxGpuHours: 5 },
    access: { users: [{ email: "ann@acme.dev", role: "admin", team: "platform" }], domains: ["acme.dev"] },
    auth: { oidc: { issuer: "https://id.acme.dev", clientId: "wb", prompt: "select_account" } },
  },
  sources: {
    github: { path: "/hooks/github", verify: { kind: "hmac", secret: "GH", rotateEvery: "30d" }, adapter: "github", rateLimit: 10 },
  },
  groups: {
    triage: {
      title: "Triage",
      autonomy: "guarded",
      actions: [{ id: "approve", label: "Approve", colour: "green" }],
      budgetUsd: 5,
    },
    other: { title: "Other", sandbox: { net: false } },
  },
  rules: [{ id: "r1", on: "pr.merged", prompt: "Do it", group: "triage", priority: 2 }],
  services: [{ id: "web", title: "Web", run: { cmd: "npm", args: ["start"], restart: "always" }, health: "/ok" }],
  terminals: [{ name: "shell", title: "Shell", pinned: true }],
};

function store() {
  const dir = mkdtempSync(join(tmpdir(), "wb-fwd-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(NEWER, null, 2));
  mkdirSync(join(dir, "skills"));
  const config = new ConfigStore(path);
  const admin = new Admin(config, new SkillStore(join(dir, "skills")), () => ({}));
  const file = () => JSON.parse(readFileSync(path, "utf8"));
  return { config, admin, file, path };
}

describe("config written by a newer build", () => {
  it("is read, with what this build does not know left out of the parsed config", () => {
    const { config } = store();
    expect(config.errors()).toBeNull();
    expect(config.get().groups.triage).not.toHaveProperty("budgetUsd");
    expect(config.get().settings.limits.maxConcurrentRuns).toBe(3);
  });

  it("keeps every unknown key, at every level, when saved through the pages' own paths", () => {
    const { config, admin, file } = store();
    // Each save sends back what this build parsed, which has the unknown keys stripped.
    const c = config.get();
    admin.setSection("settings", { ...c.settings, limits: { ...c.settings.limits, maxConcurrentRuns: 2 } });
    admin.putWorkflow("triage", { ...c.groups.triage, title: "Triage 2" } as any);
    admin.putWorkflow("other", { ...c.groups.other } as any);
    admin.upsertRule({ ...c.rules[0]!, prompt: "Do it again" });
    admin.upsertSource("github", { ...c.sources.github } as any);
    admin.setServices([{ ...c.services[0]!, title: "Web app" }]);
    admin.setSection("terminals", c.terminals.map((t) => ({ ...t, title: "Main shell" })));

    const f = file();
    expect(f.future).toEqual({ dashboards: ["ops"] });
    expect(f.settings.retentionPolicy).toBe("90d");
    expect(f.settings.box.colour).toBe("teal");
    expect(f.settings.limits).toMatchObject({ maxConcurrentRuns: 2, maxGpuHours: 5 });
    expect(f.settings.access.users[0]).toMatchObject({ email: "ann@acme.dev", team: "platform" });
    expect(f.settings.auth.oidc.prompt).toBe("select_account");
    expect(f.sources.github).toMatchObject({ rateLimit: 10, verify: { rotateEvery: "30d" } });
    expect(f.groups.triage).toMatchObject({ title: "Triage 2", budgetUsd: 5 });
    expect(f.groups.triage.actions[0]).toMatchObject({ id: "approve", colour: "green" });
    expect(f.groups.other.sandbox).toEqual({ net: false });
    expect(f.rules[0]).toMatchObject({ prompt: "Do it again", priority: 2 });
    expect(f.services[0]).toMatchObject({ title: "Web app", health: "/ok", run: { restart: "always" } });
    expect(f.terminals[0]).toMatchObject({ title: "Main shell", pinned: true });
    expect(config.errors()).toBeNull();
  });

  it("drops the unknown keys of a thing that was deleted, and of nothing else", () => {
    const { admin, file } = store();
    admin.deleteRule("r1");
    admin.deleteWorkflow("triage");
    const f = file();
    expect(f.groups.triage).toBeUndefined();
    expect(f.rules).toEqual([]);
    expect(f.groups.other.sandbox).toEqual({ net: false });
  });

  it("the JSON tab writes exactly what the person wrote, since it shows the raw file", () => {
    const { admin, file } = store();
    const raw = file().settings;
    delete raw.retentionPolicy;
    admin.setSection("settings", raw, "Edit settings JSON", true);
    expect(file().settings).not.toHaveProperty("retentionPolicy");
    expect(file().settings.box.colour).toBe("teal");
  });

  it("carryUnknown matches lists by id, name or email and leaves plain lists alone", () => {
    const prev = { l: [{ id: "a", x: 1, k: 1 }, { id: "b", x: 2 }], tags: ["a", "b"] };
    const known = { l: [{ id: "a", k: 1 }, { id: "b" }], tags: ["a", "b"] };
    expect(carryUnknown(prev, known, { l: [{ id: "b" }, { id: "c" }], tags: ["c"] })).toEqual({ l: [{ id: "b", x: 2 }, { id: "c" }], tags: ["c"] });
  });

  it("when the file has never been valid, the valid parts still load and saves stay refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-fwd-"));
    const path = join(dir, "config.json");
    const bad = structuredClone(NEWER) as any;
    bad.sources.jwt = { path: "/hooks/jwt", verify: { kind: "jwt", issuer: "x" }, adapter: "github" };
    bad.groups.triage.autonomy = "supervised";
    bad.settings.limits.maxConcurrentRuns = "lots";
    writeFileSync(path, JSON.stringify(bad));
    const config = new ConfigStore(path);
    expect(config.errors()!.length).toBeGreaterThan(0);
    const c = config.get();
    expect(Object.keys(c.sources)).toEqual(["github"]);
    expect(Object.keys(c.groups)).toEqual(["other"]);
    // The rule's workflow could not be read, so the rule is left out too.
    expect(c.rules).toEqual([]);
    expect(c.settings.limits.maxConcurrentRuns).toBe(4);
    expect(c.settings.box.name).toBe("Acme");
    expect(config.update((r) => r).ok).toBe(false);
    expect(parseValidParts({ settings: "nonsense" })).not.toBeNull();
  });
});
