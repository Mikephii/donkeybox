import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Group } from "./config.ts";
import type { RunRow } from "./types.ts";

export interface RunSpecEnv {
  runsDir: string;
  workDir: string;
  /** The workspace's skills folder (settings.skillsDir), read when the run starts. */
  skillsDir: string | (() => string);
  workspaceDir?: string;
  dataDir?: string;
  hooksDir: string;
  mcpServer: string;
  localApiUrl: string;
  claudeBin: string;
  extraPath: string[];
  /** Runs must never read this file; it unlocks the admin (setup) tools. */
  adminTokenFile?: string;
  /** The box's SSH keys. Runs must never read them. */
  keysDir?: string;
  /** The secrets file (file backend). Runs must never read it. */
  secretsFile?: string;
  /** Fills ${secret:NAME} references in the workflow's MCP server definitions. */
  expandSecrets?: <T>(v: T) => T;
}

/**
 * Links each skill (a folder with SKILL.md) from the given sources into <workdir>/.claude/skills,
 * one symlink per skill. Skills already there (a repo's own) win; links are kept out of git.
 */
export function linkSkills(workdir: string, sources: string[], excludeFile?: string): string[] {
  const target = join(workdir, ".claude/skills");
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) unlinkSync(target);
  mkdirSync(target, { recursive: true });
  const linked: string[] = [];
  for (const src of sources) {
    if (!existsSync(src)) continue;
    for (const name of readdirSync(src)) {
      if (!existsSync(join(src, name, "SKILL.md")) || existsSync(join(target, name))) continue;
      symlinkSync(join(src, name), join(target, name), "dir");
      linked.push(name);
    }
  }
  if (excludeFile && linked.length) {
    const have = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : "";
    const add = linked.map((n) => `.claude/skills/${n}`).filter((l) => !have.split("\n").includes(l));
    if (add.length) appendFileSync(excludeFile, `\n${add.join("\n")}\n`);
  }
  return linked;
}

export interface RunSpec {
  dir: string;
  workdir: string;
  script: string;
}

const BASE_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite", "mcp__workbench__*", "Bash(wb:*)", "Bash(ls:*)", "Bash(cat:*)"];
// The box has open outbound internet; runs may search and fetch the web unless their workflow says no.
const WEB_TOOLS = ["WebSearch", "WebFetch"];

/** Tools Claude Code inherits from the shell that must not leak into runs (they disable transcripts and tie the run to the parent). */
export const SCRUB = ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE",
  // Runs never act as the human session: no admin flag, token or actor.
  "WB_ADMIN", "WB_ADMIN_TOKEN", "WB_ACTOR", "WB_MANAGEMENT_TOKEN"];

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function autonomyPrompt(groupId: string, group: Group, run: RunRow): string {
  const lines = [
    `You are running inside the agent workbench as run #${run.id} in the "${group.title}" group (${groupId}).`,
    `Humans watch runs from a web UI. Use the workbench MCP tools to talk to them: create_request raises an item in the group's queue with buttons; ask_humans does the same and waits for the answer; note posts progress to the run timeline.`,
  ];
  if (group.autonomy === "autonomous") lines.push("This group is autonomous: do the job without raising requests unless something is ambiguous or destructive.");
  if (group.autonomy === "ask-first") lines.push("This group is ask-first: before changing anything outside your working directory, raise a request (ask_humans or create_request) and act only on the answer.");
  if (group.autonomy === "guarded") lines.push("This group is guarded: act freely, but some tool calls pause for human approval. If one is denied, accept the decision and report it.");
  if (run.goal) lines.push(`This run has a goal check that must pass before you can finish: \`${run.goal}\`. If you stop early you will be told to continue.`);
  lines.push("When the task is done, give a one-paragraph summary and end your turn.");
  return lines.join("\n");
}

export function buildRunSpec(
  run: RunRow,
  groupId: string,
  group: Group,
  e: RunSpecEnv,
  print: boolean,
): RunSpec {
  const dir = join(e.runsDir, String(run.id));
  mkdirSync(dir, { recursive: true });

  const fromWorkspace = (p: string) => (isAbsolute(p) ? p : resolve(e.workspaceDir ?? ".", p));
  // A workflow may start its runs in any folder on the box. The workbench writes nothing into such a
  // folder: the skills are linked into the run's own folder, which is added with --add-dir, and
  // Claude Code loads skills from added folders.
  const ownFolder = join(dir, "work");
  const workdir = run.workdir ?? (group.workdir ? fromWorkspace(group.workdir) : ownFolder);
  mkdirSync(workdir, { recursive: true });
  const skillsDir = typeof e.skillsDir === "function" ? e.skillsDir() : e.skillsDir;
  const skillHome = workdir === ownFolder ? ownFolder : join(dir, "skills");
  linkSkills(skillHome, [skillsDir, ...group.extraSkillDirs.map(fromWorkspace)]);
  const addDirs = [...(skillHome !== workdir ? [skillHome] : []), ...group.addDirs.map(fromWorkspace).filter((p) => existsSync(p))];
  const pluginDirs = group.pluginDirs.map(fromWorkspace).filter((p) => existsSync(p));

  const hook = (event: string) => ({
    type: "command",
    command: `node ${sh(join(e.hooksDir, "hook.ts"))} ${event}`,
    timeout: event === "PreToolUse" ? 86_400 : event === "Stop" ? 120 : 30,
  });
  const hookEvents = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd"];
  const settings = {
    // dontAsk refuses anything not allowed. The deny list keeps runs away from the box's own credentials.
    permissions: {
      allow: [...BASE_TOOLS, ...(group.webAccess ? WEB_TOOLS : []), ...group.allowedTools],
      deny: [
        ...(group.webAccess ? [] : WEB_TOOLS),
        ...(e.adminTokenFile ? [`Read(/${e.adminTokenFile})`, `Bash(*admin.token*)`] : []),
        ...(e.secretsFile ? [`Read(/${e.secretsFile})`, `Bash(*secrets.json*)`] : []),
        ...(e.keysDir ? [`Read(/${e.keysDir}/**)`, `Bash(*${e.keysDir}*)`] : []),
        // The run's MCP config holds resolved secret values for its servers.
        `Read(/${join(dir, "mcp.json")})`,
        `Bash(*${join(dir, "mcp.json")}*)`,
      ],
      defaultMode: "dontAsk",
    },
    hooks: Object.fromEntries(hookEvents.map((ev) => [ev, [{ ...(ev.endsWith("ToolUse") ? { matcher: "*" } : {}), hooks: [hook(ev)] }]])),
    statusLine: { type: "command", command: `node ${sh(join(e.hooksDir, "statusline.ts"))}`, padding: 0 },
  };
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));

  const runEnv = { WB_RUN_ID: String(run.id), WB_LOCAL_API: e.localApiUrl };
  const mcp = {
    mcpServers: {
      workbench: { type: "stdio", command: "node", args: [e.mcpServer], env: runEnv },
      ...(e.expandSecrets ? e.expandSecrets(group.mcpServers) : group.mcpServers),
    },
  };
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(mcp, null, 2), { mode: 0o600 });
  chmodSync(join(dir, "mcp.json"), 0o600);
  writeFileSync(join(dir, "prompt.txt"), run.prompt);
  writeFileSync(join(dir, "system.txt"), autonomyPrompt(groupId, group, run));

  const args = [
    `--settings ${sh(join(dir, "settings.json"))}`,
    `--mcp-config ${sh(join(dir, "mcp.json"))}`,
    "--strict-mcp-config",
    // No browser integration and no MCP servers beyond the workbench's and the group's own,
    // so runs cannot reach real services (Jira, Slack, ...) through connectors on this machine.
    "--no-chrome",
    "--permission-mode dontAsk",
    run.resume_session_id ? `--resume ${sh(run.resume_session_id)}` : `--session-id ${sh(run.session_id)}`,
    run.model ? `--model ${sh(run.model)}` : "",
    ...pluginDirs.map((p) => `--plugin-dir ${sh(p)}`),
    ...addDirs.map((p) => `--add-dir ${sh(p)}`),
    `--append-system-prompt "$(cat ${sh(join(dir, "system.txt"))})"`,
    print ? "-p --output-format stream-json --verbose" : `-n ${sh(`run ${run.id}`)}`,
    `"$(cat ${sh(join(dir, "prompt.txt"))})"`,
  ].filter(Boolean);

  const script = join(dir, "run.sh");
  writeFileSync(
    script,
    [
      "#!/usr/bin/env bash",
      `# Generated by the workbench for run #${run.id}. Re-run this file to restart the agent by hand.`,
      `unset ${SCRUB.join(" ")}`,
      `export WB_RUN_ID=${run.id} WB_LOCAL_API=${sh(e.localApiUrl)} MCP_TOOL_TIMEOUT=86400000`,
      ...(e.dataDir ? [`export WB_DATA_DIR=${sh(e.dataDir)}`] : []),
      ...(e.workspaceDir ? [`export WB_WORKSPACE_DIR=${sh(e.workspaceDir)}`] : []),
      `export PATH=${e.extraPath.map(sh).join(":")}:"$PATH"`,
      `cd ${sh(workdir)}`,
      `exec ${sh(e.claudeBin)} \\\n  ${args.join(" \\\n  ")}`,
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return { dir, workdir, script };
}
