import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectClaude, setupItems, type SetupFacts } from "../src/lib/setup.ts";

const base: SetupFacts = {
  authMode: "proxy",
  dataMount: { expected: true, mounted: true },
  hooksBase: "https://hooks.example.com",
  hooksBaseFrom: "settings",
  claude: { installed: true, signedIn: true, how: "API key" },
  hasAdmin: true,
  workspace: { remote: "git@x:y.git", lastPushAt: "2026-10-16T00:00:00Z", lastError: null },
  missingSecrets: [],
  acceptedDelivery: { source: "github", at: "now" },
  workflowSaved: { summary: "Ann changed workflow x", at: "now" },
};
const byId = (f: SetupFacts) => Object.fromEntries(setupItems(f).map((i) => [i.id, i]));

describe("setup checklist", () => {
  it("is all green for a finished box", () => {
    expect(setupItems(base).every((i) => i.done)).toBe(true);
  });
  it("detects each missing piece and says what to do", () => {
    const f = byId({
      ...base, hasAdmin: false, dataMount: { expected: true, mounted: false }, hooksBase: null, hooksBaseFrom: null,
      claude: { installed: false, signedIn: false, how: null }, workspace: { remote: null, lastPushAt: null, lastError: null },
      missingSecrets: [{ name: "JIRA_HOOK_SECRET", usedBy: ["source jira"] }], acceptedDelivery: null, workflowSaved: null,
    });
    expect(Object.values(f).filter((i) => !i.done).map((i) => i.id).sort()).toEqual(["admin", "claude", "data", "delivery", "hooks-url", "remote", "secrets", "workflow"]);
    expect(f.claude!.detail).toMatch(/wb tools install claude-code/);
    expect(f.secrets!.detail).toMatch(/JIRA_HOOK_SECRET \(source jira\)/);
    expect(f.data!.detail).toMatch(/would lose everything/);
    expect(f.remote!.optional).toBe(true);
    expect(f.remote!.detail).toMatch(/not your code/);
  });
  it("accepts the local defaults on a laptop", () => {
    const f = byId({ ...base, authMode: "dev", dataMount: { expected: false, mounted: false }, hooksBaseFrom: "default", hooksBase: "http://localhost:8080" });
    expect(f.data!.done).toBe(true);
    expect(f["hooks-url"]!.done).toBe(true);
    expect(byId({ ...base, authMode: "dev", hasAdmin: false }).admin!.done).toBe(true);
    expect(byId({ ...base, authMode: "proxy", hasAdmin: false }).admin!.done).toBe(false);
    const hosted = byId({ ...base, hooksBaseFrom: "default", hooksBase: "http://localhost:8080" });
    expect(hosted["hooks-url"]!.done).toBe(false);
  });
  it("says installed but not signed in", () => {
    expect(byId({ ...base, claude: { installed: true, signedIn: false, how: null } }).claude!.detail).toMatch(/\/login/);
  });
});

describe("Claude Code sign-in detection", () => {
  const home = () => mkdtempSync(join(tmpdir(), "wb-home-"));
  const bin = () => {
    const d = mkdtempSync(join(tmpdir(), "wb-bin-"));
    writeFileSync(join(d, "claude"), "#!/bin/sh\n");
    return join(d, "claude");
  };
  it("finds an API key, an OAuth account, stored credentials, the keychain, or nothing", () => {
    expect(detectClaude({ bin: null, env: {}, home: home() })).toEqual({ installed: false, signedIn: false, how: null });
    expect(detectClaude({ bin: bin(), env: { ANTHROPIC_API_KEY: "k" }, home: home() })).toMatchObject({ installed: true, signedIn: true, how: "ANTHROPIC_API_KEY" });
    const h1 = home();
    writeFileSync(join(h1, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "box@acme.dev" } }));
    expect(detectClaude({ bin: bin(), env: {}, home: h1 }).how).toBe("account box@acme.dev");
    const h2 = home();
    mkdirSync(join(h2, ".claude"));
    writeFileSync(join(h2, ".claude/.credentials.json"), "{}");
    expect(detectClaude({ bin: bin(), env: {}, home: h2 }).signedIn).toBe(true);
    expect(detectClaude({ bin: bin(), env: {}, home: home(), keychain: () => true }).how).toBe("macOS keychain");
    expect(detectClaude({ bin: bin(), env: {}, home: home(), keychain: () => false }).signedIn).toBe(false);
  });
});
