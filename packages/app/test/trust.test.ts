import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeConfigPath, trustFolder } from "../src/lib/claude-trust.ts";

describe("Claude Code folder trust for unattended runs", () => {
  it("adds hasTrustDialogAccepted for the run folder and keeps everything else in the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-trust-"));
    const file = join(dir, ".claude.json");
    writeFileSync(file, JSON.stringify({ numStartups: 3, projects: { "/other": { allowedTools: ["x"], hasTrustDialogAccepted: false } } }));
    const run = mkdtempSync(join(tmpdir(), "wb-run-"));
    expect(await trustFolder(run, file)).toBe(true);
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    expect(cfg.numStartups).toBe(3);
    expect(cfg.projects["/other"]).toEqual({ allowedTools: ["x"], hasTrustDialogAccepted: false });
    expect(cfg.projects[run].hasTrustDialogAccepted).toBe(true);
    expect(await trustFolder(run, file)).toBe(true);
  });
  it("uses CLAUDE_CONFIG_DIR when set", () => {
    expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: "/x/cfg" })).toBe("/x/cfg/.claude.json");
  });
});
