// Installs pinned programs into the tools folder (WB_TOOLS_DIR/bin; on a box it lives on the data volume
// so installs survive image updates). Versions come from versions.json at the product root.
//   node tools.ts install code-server|claude-code|zellij|caddy [--version V]
//   node tools.ts list
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TOOLS_DIR } from "./env.ts";

const versions = JSON.parse(readFileSync(join(ROOT, "versions.json"), "utf8")) as Record<string, string>;
const BIN = join(TOOLS_DIR, "bin");
const os = process.platform === "darwin" ? "darwin" : "linux";
const arm = process.arch === "arm64";

function sh(cmd: string, args: string[], cwd?: string) {
  execFileSync(cmd, args, { stdio: "inherit", cwd });
}
function download(url: string, dest: string) {
  console.log(`downloading ${url}`);
  sh("curl", ["-fsSL", "--retry", "3", "-o", dest, url]);
}
function link(target: string, name: string) {
  mkdirSync(BIN, { recursive: true });
  const l = join(BIN, name);
  if (existsSync(l) || isLink(l)) unlinkSync(l);
  symlinkSync(target, l);
}
function isLink(p: string) {
  try {
    execFileSync("test", ["-L", p]);
    return true;
  } catch {
    return false;
  }
}

const installers: Record<string, (v: string) => void> = {
  "code-server": (v) => {
    const dir = join(TOOLS_DIR, `code-server-${v}`);
    if (!existsSync(join(dir, "bin/code-server"))) {
      const plat = `${os === "darwin" ? "macos" : "linux"}-${arm ? "arm64" : "amd64"}`;
      const tmp = join(TOOLS_DIR, `.code-server-${v}.tar.gz`);
      mkdirSync(TOOLS_DIR, { recursive: true });
      download(`https://github.com/coder/code-server/releases/download/v${v}/code-server-${v}-${plat}.tar.gz`, tmp);
      const work = join(TOOLS_DIR, `.code-server-${v}`);
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      sh("tar", ["-xzf", tmp, "-C", work, "--strip-components", "1"]);
      rmSync(dir, { recursive: true, force: true });
      renameSync(work, dir);
      rmSync(tmp, { force: true });
    }
    link(join(dir, "bin/code-server"), "code-server");
  },
  "claude-code": (v) => {
    const dir = join(TOOLS_DIR, `claude-code-${v}`);
    if (!existsSync(join(dir, "node_modules/.bin/claude"))) {
      mkdirSync(dir, { recursive: true });
      sh("npm", ["install", "--no-audit", "--no-fund", "--prefix", dir, `@anthropic-ai/claude-code@${v}`]);
    }
    link(join(dir, "node_modules/.bin/claude"), "claude");
  },
  zellij: (v) => {
    const target = os === "darwin" ? `${arm ? "aarch64" : "x86_64"}-apple-darwin` : `${arm ? "aarch64" : "x86_64"}-unknown-linux-musl`;
    mkdirSync(BIN, { recursive: true });
    const tmp = join(TOOLS_DIR, ".zellij.tar.gz");
    download(`https://github.com/zellij-org/zellij/releases/download/v${v}/zellij-${target}.tar.gz`, tmp);
    sh("tar", ["-xzf", tmp, "-C", BIN, "zellij"]);
    rmSync(tmp, { force: true });
    chmodSync(join(BIN, "zellij"), 0o755);
  },
  caddy: (v) => {
    const target = `${os === "darwin" ? "mac" : "linux"}_${arm ? "arm64" : "amd64"}`;
    mkdirSync(BIN, { recursive: true });
    const tmp = join(TOOLS_DIR, ".caddy.tar.gz");
    download(`https://github.com/caddyserver/caddy/releases/download/v${v}/caddy_${v}_${target}.tar.gz`, tmp);
    sh("tar", ["-xzf", tmp, "-C", BIN, "caddy"]);
    rmSync(tmp, { force: true });
    chmodSync(join(BIN, "caddy"), 0o755);
  },
};
const versionKey: Record<string, string> = { "code-server": "codeServer", "claude-code": "claudeCode", zellij: "zellij", caddy: "caddy" };

const [cmd, name, ...rest] = process.argv.slice(2);
// In the image, files on /data belong to the workbench user; a root install would leave them unwritable.
if (cmd === "install" && process.getuid?.() === 0 && TOOLS_DIR.startsWith("/data/")) {
  console.error("run this as the workbench user, e.g. docker exec -u workbench <container> wb tools install " + (name ?? "NAME"));
  process.exit(1);
}
if (cmd === "list") {
  for (const n of Object.keys(installers)) {
    const bin = join(BIN, n === "claude-code" ? "claude" : n);
    console.log(`${n.padEnd(12)} pinned ${versions[versionKey[n]!]?.padEnd(10)} ${existsSync(bin) ? `installed at ${bin}` : "not installed"}`);
  }
} else if (cmd === "install" && name && installers[name]) {
  const i = rest.indexOf("--version");
  const v = i >= 0 ? rest[i + 1]! : versions[versionKey[name]!]!;
  installers[name]!(v);
  console.log(`${name} ${v} installed in ${BIN}`);
} else {
  console.log("usage: wb tools install code-server|claude-code|zellij|caddy [--version V]\n       wb tools list");
  process.exit(cmd ? 1 : 0);
}
