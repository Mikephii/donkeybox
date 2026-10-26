import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code asks "do you trust this folder?" the first time it starts in a folder, and an unattended
 * run would sit on that question forever. Inside a git repo it only looks for trust up to the repo's
 * root, so every run worktree needs its own entry. This records the same answer the dialog writes
 * (projects[path].hasTrustDialogAccepted in the box user's Claude config) before the run starts.
 */
export function claudeConfigPath(env: NodeJS.ProcessEnv = process.env) {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json");
}

export async function trustFolder(folder: string, file = claudeConfigPath()): Promise<boolean> {
  const paths = new Set([folder]);
  try {
    paths.add(realpathSync(folder));
  } catch {}
  // Claude Code rewrites this file too; re-read after writing and try again if our entry was lost.
  for (let attempt = 0; attempt < 5; attempt++) {
    let cfg: Record<string, any> = {};
    try {
      if (existsSync(file)) cfg = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    const projects = (cfg.projects ??= {});
    const missing = [...paths].filter((p) => projects[p]?.hasTrustDialogAccepted !== true);
    if (!missing.length) return true;
    for (const p of missing) projects[p] = { ...(projects[p] ?? {}), hasTrustDialogAccepted: true };
    const tmp = `${file}.wb-${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
    await new Promise((r) => setTimeout(r, 50 + attempt * 100));
  }
  return false;
}
