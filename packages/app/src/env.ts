import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { productVersion } from "./release.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The product: this repo. Never edited to configure a deployment. */
export const ROOT = resolve(process.env.WB_PRODUCT_DIR ?? process.env.WB_ROOT ?? join(here, "../../.."));
/** Per-box state that outlives deploys: database, Yjs, runs, worktrees, repos, tokens, secrets, keys. */
export const DATA_DIR = resolve(process.env.WB_DATA_DIR ?? join(ROOT, "data"));
/** The user's configuration repo: config.json, skills, bin/, CLAUDE.md. */
export const WORKSPACE_DIR = resolve(process.env.WB_WORKSPACE_DIR ?? join(ROOT, "workspace"));
/** Programs installed per box (Claude Code, code-server, ...). On a box this lives on the data volume. */
export const TOOLS_DIR = resolve(process.env.WB_TOOLS_DIR ?? join(ROOT, ".tools"));

// Children (sessions, runs, hooks, wb, the MCP server) find everything through these.
process.env.WB_PRODUCT_DIR = ROOT;
process.env.WB_DATA_DIR = DATA_DIR;
process.env.WB_WORKSPACE_DIR = WORKSPACE_DIR;
process.env.WB_TOOLS_DIR = TOOLS_DIR;

export function bin(name: string): string {
  for (const p of [join(TOOLS_DIR, "bin", name), join(ROOT, ".tools/bin", name)]) if (existsSync(p)) return p;
  return name;
}

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

/** Short (macOS caps socket paths at 103 bytes) and unique per data dir, so two boxes on one machine never share sessions. */
const socketSuffix = createHash("sha256").update(DATA_DIR).digest("hex").slice(0, 8);

export type AuthMode = "dev" | "iap" | "proxy" | "oidc";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  version: productVersion(),
  authMode: (process.env.AUTH_MODE ?? "dev") as AuthMode,
  devUserEmail: process.env.DEV_USER_EMAIL ?? "dev@localhost",
  iapAudience: process.env.IAP_AUDIENCE ?? "",
  bootstrapAdmin: process.env.WB_BOOTSTRAP_ADMIN ?? "",
  publicPort: num(process.env.WB_PUBLIC_PORT, 8000),
  localApiPort: num(process.env.WB_LOCAL_API_PORT, 8001),
  managementPort: num(process.env.WB_MANAGEMENT_PORT, 8002),
  managementHost: process.env.WB_MANAGEMENT_HOST ?? "127.0.0.1",
  managementToken: process.env.WB_MANAGEMENT_TOKEN ?? "",
  yjsPort: num(process.env.WB_YJS_PORT, 1234),
  hooksPort: num(process.env.WB_HOOKS_PORT, 9000),
  supervisorPort: num(process.env.WB_SUPERVISOR_PORT, 8009),
  zellijWebPort: num(process.env.WB_ZELLIJ_WEB_PORT, 8082),
  codeServerPort: num(process.env.WB_CODE_SERVER_PORT, 8443),
  appDoorPort: num(process.env.WB_APP_DOOR_PORT, 8080),
  hooksDoorPort: num(process.env.WB_HOOKS_DOOR_PORT, 0),
  vitePort: num(process.env.WB_VITE_PORT, 5173),
  serveStatic: process.env.WB_SERVE_STATIC === "1",
  /** Shown as the webhook base when Settings has none. `pnpm start` sets it to the local door. */
  defaultHooksUrl: process.env.WB_DEFAULT_HOOKS_URL ?? "",
  /** Written into settings on first boot when the setting is empty (set by Terraform, compose or the host). */
  seedPublicHooksUrl: process.env.WB_SEED_PUBLIC_HOOKS_URL ?? "",
  seedPublicAppUrl: process.env.WB_SEED_PUBLIC_APP_URL ?? "",
  /** JSON merged into settings on boot, only where config.json has nothing set. */
  seedSettings: process.env.WB_SEED_SETTINGS ?? "",
  secretsBackend: (process.env.WB_SECRETS ?? "file") as "file" | "gcp",
  gcpProject: process.env.WB_GCP_PROJECT ?? "",
  /** Secret Manager ids are <prefix><NAME>; one prefix per box when boxes share a project. */
  gcpSecretPrefix: process.env.WB_GCP_SECRET_PREFIX ?? "workbench-",
  configPath: join(WORKSPACE_DIR, "config.json"),
  templateDir: resolve(process.env.WB_TEMPLATE_DIR ?? join(ROOT, "workspace-template")),
  zellij: process.env.WB_ZELLIJ_BIN ?? bin("zellij"),
  claude: process.env.WB_CLAUDE_BIN ?? bin("claude"),
  codeServer: process.env.WB_CODE_SERVER_BIN ?? bin("code-server"),
  zellijConfig: resolve(process.env.ZELLIJ_CONFIG_FILE ?? join(ROOT, "packages/app/zellij/config.kdl")),
  zellijSocketDir: process.env.ZELLIJ_SOCKET_DIR ?? `/tmp/wb-zj-${socketSuffix}`,
  zellijTokensDb:
    process.env.WB_ZELLIJ_TOKENS_DB ??
    (platform() === "darwin"
      ? join(homedir(), "Library/Application Support/org.Zellij-Contributors.Zellij/tokens.db")
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "zellij/tokens.db")),
  goalMaxIterations: num(process.env.WB_GOAL_MAX_ITERATIONS, 6),
  /** Mounted volume expected for data (a box); locally false. Drives the Setup page's disk check. */
  expectDataMount: process.env.WB_EXPECT_DATA_MOUNT === "1",
};
process.env.ZELLIJ_SOCKET_DIR = env.zellijSocketDir;
process.env.ZELLIJ_CONFIG_FILE = env.zellijConfig;
// Zellij ignores a session's --default-layout when its config folder is missing, which it always is
// in a fresh box home: every terminal would start as a bare shell in the server's folder. Point it at
// the folder of the config file, which always exists.
process.env.ZELLIJ_CONFIG_DIR = dirname(env.zellijConfig);
// Zellij passes its own environment to the shells in its panes. A container has no TERM, so without
// this `less` (git's pager) and other full-screen programs think the terminal is a dumb one.
process.env.TERM ||= "xterm-256color";

export const localApiUrl = `http://127.0.0.1:${env.localApiPort}`;
export const paths = {
  db: join(DATA_DIR, "workbench.db"),
  runs: join(DATA_DIR, "runs"),
  work: join(DATA_DIR, "work"),
  logs: join(DATA_DIR, "logs"),
  yjs: join(DATA_DIR, "yjs"),
  keys: join(DATA_DIR, "keys"),
  secrets: join(DATA_DIR, "secrets.json"),
  layouts: join(DATA_DIR, "zellij-layouts"),
  caddyfile: join(DATA_DIR, "Caddyfile"),
  codeServerData: join(DATA_DIR, "code-server"),
  codeWorkspaceFile: join(DATA_DIR, "workbench.code-workspace"),
  hooksDir: join(ROOT, "packages/hooks/src"),
  cli: join(ROOT, "packages/cli/src/wb.ts"),
  mcp: join(ROOT, "packages/mcp/src/server.ts"),
  workspaceBin: join(WORKSPACE_DIR, "bin"),
  cliBin: join(ROOT, "packages/cli/bin"),
  toolsBin: join(TOOLS_DIR, "bin"),
  web: join(ROOT, "packages/app/dist"),
  adminToken: join(DATA_DIR, "admin.token"),
  state: join(DATA_DIR, "state.json"),
};
