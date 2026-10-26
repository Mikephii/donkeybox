import { execFile, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { WriteInfo } from "../engine/config.ts";

/**
 * The workspace is the box's own config folder (config.json, skills, scripts), never anyone's code.
 * The app commits its own saves there with the person as author and, when a remote is set, keeps it
 * in step: push after each commit, fast-forward pull every few minutes, pause on divergence.
 * What agents and people do with their own code repos is entirely up to their skills.
 */
export interface WorkspaceState {
  dir: string;
  git: boolean;
  branch: string | null;
  head: string | null;
  remote: string | null;
  ahead: number;
  behind: number;
  /** Local and remote both have commits the other lacks; auto-commit is paused until a person resolves it. */
  diverged: boolean;
  /** Saves were written while paused and are not committed yet. */
  uncommitted: boolean;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastError: string | null;
}

const COMMITTER = { name: "Workbench", email: "workbench@localhost" };

export function isEmptyDir(dir: string) {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/**
 * Creates the workspace from the template when the folder is missing or empty, with a first commit.
 * Never touches a folder that has anything in it.
 */
export function createWorkspaceFromTemplate(dir: string, templateDir: string): boolean {
  if (!isEmptyDir(dir)) return false;
  mkdirSync(dir, { recursive: true });
  cpSync(templateDir, dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", `user.name=${COMMITTER.name}`, "-c", `user.email=${COMMITTER.email}`, "commit", "-q", "-m", "Create workspace from template"]);
  return true;
}

function git(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", ["-C", dir, ...args], { env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitAsync(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) =>
    execFile("git", ["-C", dir, ...args], { env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" }, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as any).code ?? 1) : 0, out: `${stdout}${stderr}`.trim() }),
    ),
  );
}

/**
 * The workspace as a git repo. Every save is one commit authored by the person who made it.
 * With a remote: push after commits (debounced, retried), pull --ff-only on a timer and on demand.
 */
export class Workspace {
  dir: string;
  sshCommand: () => string | undefined;
  onChange: () => void;
  state: WorkspaceState;
  private pushTimer: NodeJS.Timeout | null = null;
  private pushRetry = 0;
  private syncing: Promise<void> | null = null;

  constructor(dir: string, opts: { sshCommand?: () => string | undefined; onChange?: () => void } = {}) {
    this.dir = dir;
    this.sshCommand = opts.sshCommand ?? (() => undefined);
    this.onChange = opts.onChange ?? (() => {});
    this.state = { dir, git: false, branch: null, head: null, remote: null, ahead: 0, behind: 0, diverged: false, uncommitted: false, lastPullAt: null, lastPushAt: null, lastError: null };
    this.refresh();
  }

  private env(): NodeJS.ProcessEnv {
    const ssh = this.sshCommand();
    return ssh ? { GIT_SSH_COMMAND: ssh } : {};
  }

  isGit() {
    return existsSync(join(this.dir, ".git"));
  }

  refresh() {
    this.state.git = this.isGit();
    if (!this.state.git) return;
    try {
      this.state.branch = git(this.dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      this.state.head = git(this.dir, ["rev-parse", "--short", "HEAD"]);
    } catch {
      this.state.head = null;
    }
    try {
      this.state.remote = git(this.dir, ["remote", "get-url", "origin"]) || null;
    } catch {
      this.state.remote = null;
    }
  }

  /** Commits the given paths (relative or absolute, inside the workspace). Skipped while diverged. */
  commit(info: WriteInfo, paths: string[]): { committed: boolean; reason?: string } {
    if (!this.isGit()) return { committed: false, reason: "workspace is not a git repo" };
    if (this.state.diverged) {
      this.state.uncommitted = true;
      this.onChange();
      return { committed: false, reason: "diverged from remote" };
    }
    const rel = paths.map((p) => (p.startsWith("/") ? relative(this.dir, p) : p)).filter((p) => p && !p.startsWith(".."));
    try {
      git(this.dir, ["add", "-A", "--", ...rel]);
      const staged = git(this.dir, ["diff", "--cached", "--name-only"]);
      if (!staged) return { committed: false, reason: "nothing changed" };
      const author = info.author ?? COMMITTER;
      git(this.dir, [
        "-c", `user.name=${COMMITTER.name}`, "-c", `user.email=${COMMITTER.email}`,
        "commit", "-q", "--author", `${author.name} <${author.email}>`, "-m", info.message, "--", ...rel,
      ]);
      this.refresh();
      this.schedulePush();
      this.onChange();
      return { committed: true };
    } catch (e) {
      this.state.lastError = (e as Error).message.split("\n").slice(0, 3).join(" ");
      this.onChange();
      return { committed: false, reason: this.state.lastError };
    }
  }

  setRemote(url: string | null) {
    if (!this.isGit()) return;
    const current = this.state.remote;
    if (!url) {
      if (current) git(this.dir, ["remote", "remove", "origin"]);
    } else if (!current) git(this.dir, ["remote", "add", "origin", url]);
    else if (current !== url) git(this.dir, ["remote", "set-url", "origin", url]);
    this.refresh();
    this.state.diverged = false;
    this.state.lastError = null;
    this.onChange();
  }

  schedulePush(delayMs = 3000) {
    if (!this.state.remote) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.sync("push"), delayMs);
  }

  /** Fetches, fast-forwards, pushes. Detects divergence and pauses commits until it is resolved. */
  sync(reason = "timer"): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync(reason).finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async doSync(_reason: string) {
    this.refresh();
    if (!this.state.git || !this.state.remote || !this.state.branch) return;
    const env = this.env();
    const branch = this.state.branch;
    const fetched = await gitAsync(this.dir, ["fetch", "-q", "origin"], env);
    if (fetched.code !== 0) {
      this.state.lastError = `fetch failed: ${fetched.out.slice(0, 300)}`;
      this.onChange();
      return;
    }
    const hasRemoteBranch = (await gitAsync(this.dir, ["rev-parse", "--verify", "-q", `origin/${branch}`])).code === 0;
    if (hasRemoteBranch) {
      const counts = await gitAsync(this.dir, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
      const [ahead, behind] = counts.out.split(/\s+/).map(Number);
      this.state.ahead = ahead ?? 0;
      this.state.behind = behind ?? 0;
      this.state.diverged = this.state.ahead > 0 && this.state.behind > 0;
      if (this.state.diverged) {
        this.state.lastError = `workspace and origin/${branch} have both moved (${this.state.ahead} local, ${this.state.behind} remote commits). Resolve with git in a terminal; commits are paused.`;
        this.onChange();
        return;
      }
      if (this.state.behind > 0) {
        const pulled = await gitAsync(this.dir, ["merge", "--ff-only", "-q", `origin/${branch}`], env);
        if (pulled.code !== 0) {
          this.state.lastError = `pull failed: ${pulled.out.slice(0, 300)}`;
          this.onChange();
          return;
        }
        this.state.lastPullAt = new Date().toISOString();
        this.state.behind = 0;
      }
    }
    // Back in step: commit anything saved while paused, then push.
    if (this.state.uncommitted) {
      this.state.uncommitted = false;
      this.commit({ message: "Changes saved while the workspace was out of step with its remote" }, ["."]);
    }
    const ahead = hasRemoteBranch ? (await gitAsync(this.dir, ["rev-list", "--count", `origin/${branch}..HEAD`])).out : "1";
    if (Number(ahead) > 0) {
      const pushed = await gitAsync(this.dir, ["push", "-q", "-u", "origin", branch], env);
      if (pushed.code !== 0) {
        this.state.lastError = `push failed: ${pushed.out.slice(0, 300)}`;
        this.pushRetry = Math.min(this.pushRetry + 1, 6);
        this.schedulePush(Math.min(5000 * 2 ** this.pushRetry, 300_000));
        this.onChange();
        return;
      }
      this.pushRetry = 0;
      this.state.lastPushAt = new Date().toISOString();
      this.state.ahead = 0;
    }
    this.state.lastError = null;
    this.refresh();
    this.onChange();
  }
}
