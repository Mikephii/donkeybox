import { execFile } from "node:child_process";

export interface ZellijSession {
  name: string;
  exited: boolean;
  created: string;
}

/** Thin wrapper over the zellij CLI. Every call carries the workbench config file. */
export class Zellij {
  bin: string;
  configFile: string;
  socketDir: string;
  constructor(bin: string, configFile: string, socketDir: string) {
    this.bin = bin;
    this.configFile = configFile;
    this.socketDir = socketDir;
  }

  exec(args: string[], timeoutMs = 15_000): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        this.bin,
        args,
        { env: { ...process.env, ZELLIJ_CONFIG_FILE: this.configFile, ZELLIJ_SOCKET_DIR: this.socketDir }, timeout: timeoutMs },
        (err, stdout, stderr) => {
          const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }

  private async ok(args: string[]): Promise<string> {
    const r = await this.exec(args);
    if (r.code !== 0) throw new Error(`zellij ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  }

  async list(): Promise<ZellijSession[]> {
    // One hung session server makes `zellij ls` wait forever; give up quickly rather than hang pages.
    const r = await this.exec(["list-sessions", "--no-formatting"], 5_000);
    if (r.code !== 0) return [];
    return r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(\S+)\s+\[Created (.+?)\](.*)$/);
        return { name: m?.[1] ?? l.split(" ")[0]!, created: m?.[2] ?? "", exited: /EXITED/.test(l) };
      });
  }

  async alive(name: string): Promise<boolean> {
    return (await this.list()).some((s) => s.name === name && !s.exited);
  }

  async exists(name: string): Promise<boolean> {
    return (await this.list()).some((s) => s.name === name);
  }

  /** Detached session whose first pane runs `command`. */
  async createWithCommand(name: string, command: string[]): Promise<void> {
    await this.ok(["attach", "--create-background", name, "--", ...command]);
  }

  /**
   * Detached session built from a layout file. `attach -b` ignores --layout, and tabs added to a
   * detached session with `action new-tab` are dropped when the first client attaches (0.45.1).
   * Passing the layout as the session's default layout at creation is the reliable path.
   */
  async createWithLayout(name: string, layoutPath: string, focusTab?: string): Promise<void> {
    await this.ok(["attach", "--create-background", name, "options", "--default-layout", layoutPath]);
    if (focusTab) {
      for (let i = 0; i < 25; i++) {
        if ((await this.exec(["--session", name, "action", "go-to-tab-name", focusTab])).code === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  async writeChars(session: string, pane: string, text: string): Promise<void> {
    await this.ok(["--session", session, "action", "write-chars", "--pane-id", pane, text]);
  }

  async pressEnter(session: string, pane: string): Promise<void> {
    await this.ok(["--session", session, "action", "write", "--pane-id", pane, "13"]);
  }

  async dumpScreen(session: string, pane: string, full = false): Promise<string> {
    const r = await this.exec(["--session", session, "action", "dump-screen", "--pane-id", pane, ...(full ? ["--full"] : [])]);
    return r.stdout;
  }

  async kill(name: string): Promise<void> {
    await this.exec(["kill-session", name]);
  }

  async delete(name: string): Promise<void> {
    await this.exec(["kill-session", name]);
    await this.exec(["delete-session", "--force", name]);
  }

  // ── web login tokens ──
  /** A web login token; read-only tokens can only watch sessions (viewers). */
  async createToken(readOnly = false): Promise<{ name: string; token: string }> {
    const out = await this.ok(["web", readOnly ? "--create-read-only-token" : "--create-token"]);
    const m = out.match(/^\s*(\S+):\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\s*\(read-only\))?\s*$/m);
    if (!m) throw new Error(`could not parse zellij token output: ${out}`);
    return { name: m[1]!, token: m[2]! };
  }

  async listTokens(): Promise<string[]> {
    const r = await this.exec(["web", "--list-tokens"]);
    return r.stdout
      .split("\n")
      .map((l) => l.match(/^(.+?): created at/)?.[1])
      .filter((x): x is string => !!x);
  }

  async revokeToken(name: string): Promise<void> {
    await this.exec(["web", "--revoke-token", name]);
  }

  async webStatus(): Promise<boolean> {
    const r = await this.exec(["web", "--status", "--timeout", "2"], 5000);
    return r.code === 0 && /online/i.test(r.stdout);
  }
}
