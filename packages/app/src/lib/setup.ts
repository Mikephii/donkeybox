import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Setup page's checklist. Every item works out its own state from the box, so the page is
 * always true without anyone ticking anything.
 */
export interface SetupItem {
  id: string;
  title: string;
  done: boolean;
  optional: boolean;
  /** What is missing, or what was found. */
  detail: string;
  /** Where to fix it in the app. */
  link: string;
}

export interface SetupFacts {
  authMode: string;
  dataMount: { expected: boolean; mounted: boolean };
  hooksBase: string | null;
  hooksBaseFrom: "settings" | "default" | null;
  claude: { installed: boolean; signedIn: boolean; how: string | null };
  hasAdmin: boolean;
  workspace: { remote: string | null; lastPushAt: string | null; lastError: string | null } | null;
  missingSecrets: { name: string; usedBy: string[] }[];
  acceptedDelivery: { source: string; at: string } | null;
  workflowSaved: { summary: string; at: string } | null;
}

export function setupItems(f: SetupFacts): SetupItem[] {
  const local = f.authMode === "dev";
  return [
    {
      id: "admin",
      title: "Someone is an admin",
      done: f.hasAdmin || local,
      optional: false,
      detail: f.hasAdmin ? "Settings › People has an admin." : local ? "Dev mode: everyone on this machine is an admin." : "Nobody is an admin yet. Claim it below, then add your team in Settings › People.",
      link: "/settings?tab=access",
    },
    {
      id: "data",
      title: "Data is on a volume that survives redeploys",
      done: f.dataMount.mounted || !f.dataMount.expected,
      optional: !f.dataMount.expected,
      detail: f.dataMount.mounted ? "The data folder is on its own volume." : f.dataMount.expected ? "The data folder is not on a separate volume: replacing the box would lose everything. See your hosting guide." : "Running on this computer's own disk; back it up like any other folder.",
      link: "/settings",
    },
    {
      id: "hooks-url",
      title: "Webhook base URL is set",
      done: f.hooksBaseFrom === "settings" || (local && !!f.hooksBase),
      optional: false,
      detail: f.hooksBaseFrom === "settings" ? `Webhooks go to ${f.hooksBase}.` : f.hooksBase ? `Using ${f.hooksBase}, which only works on this machine.` : "The box cannot see its own public address. Set it in Settings › General.",
      link: "/settings",
    },
    {
      id: "claude",
      title: "Claude Code is installed and signed in",
      done: f.claude.installed && f.claude.signedIn,
      optional: false,
      detail: !f.claude.installed
        ? "Not installed. In a terminal run: wb tools install claude-code"
        : f.claude.signedIn
          ? `Signed in (${f.claude.how}). Make sure it is a key or seat your plan permits to be shared.`
          : "Installed but not signed in. In a terminal run claude, then /login, with a key or seat permitted for shared use.",
      link: "/c/work",
    },
    {
      id: "secrets",
      title: "Every secret that config refers to is set",
      done: f.missingSecrets.length === 0,
      optional: false,
      detail: f.missingSecrets.length ? `Missing: ${f.missingSecrets.map((s) => `${s.name} (${s.usedBy.join(", ")})`).join("; ")}.` : "All referenced secrets have values.",
      link: "/secrets",
    },
    {
      id: "delivery",
      title: "A webhook delivery was accepted",
      done: !!f.acceptedDelivery,
      optional: false,
      detail: f.acceptedDelivery ? `Last accepted on ${f.acceptedDelivery.source}.` : "Open a source and press Send a test delivery.",
      link: "/sources",
    },
    {
      id: "workflow",
      title: "A workflow was saved",
      done: !!f.workflowSaved,
      optional: false,
      detail: f.workflowSaved ? f.workflowSaved.summary : "Create a workflow, or edit one of the examples and save it.",
      link: "/workflows",
    },
    {
      id: "remote",
      title: "The box's config is pushed to a git remote",
      done: !!f.workspace?.remote && !!f.workspace.lastPushAt && !f.workspace.lastError,
      optional: true,
      detail: !f.workspace?.remote
        ? "No remote: the box's config folder (config.json, skills, scripts) lives only on this box. This is the box's own settings, not your code."
        : f.workspace.lastError ? f.workspace.lastError : f.workspace.lastPushAt ? `Pushing the box's config to ${f.workspace.remote}.` : "Remote set; waiting for the first push.",
      link: "/settings?tab=workspace",
    },
  ];
}

/** Claude Code is installed if its binary is found, and signed in if any of its credentials exist. */
export function detectClaude(o: { bin: string | null; env?: NodeJS.ProcessEnv; home?: string; keychain?: () => boolean }): SetupFacts["claude"] {
  const env = o.env ?? process.env;
  const home = o.home ?? homedir();
  const installed = !!o.bin && existsSync(o.bin);
  if (env.ANTHROPIC_API_KEY) return { installed, signedIn: true, how: "ANTHROPIC_API_KEY" };
  const cfgPath = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home, ".claude.json");
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    if (cfg.oauthAccount?.emailAddress) return { installed, signedIn: true, how: `account ${cfg.oauthAccount.emailAddress}` };
    if (cfg.primaryApiKey) return { installed, signedIn: true, how: "API key" };
  } catch {}
  const credDir = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  if (existsSync(join(credDir, ".credentials.json"))) return { installed, signedIn: true, how: "stored credentials" };
  if (o.keychain?.()) return { installed, signedIn: true, how: "macOS keychain" };
  return { installed, signedIn: false, how: null };
}
