#!/usr/bin/env bash
# Installs everything the workbench needs to run locally (macOS) or on the VM (Linux).
# Zellij and Caddy are downloaded as official release binaries into .tools/bin,
# so nothing touches system paths and no compiler is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.tools/bin"
pin() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$ROOT/versions.json"; }
ZELLIJ_VERSION="${ZELLIJ_VERSION:-$(pin zellij)}"
CADDY_VERSION="${CADDY_VERSION:-$(pin caddy)}"
mkdir -p "$TOOLS" "$ROOT/data"

os="$(uname -s)"; arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64)  z_target=aarch64-apple-darwin;      c_target=mac_arm64 ;;
  Darwin-x86_64) z_target=x86_64-apple-darwin;       c_target=mac_amd64 ;;
  Linux-x86_64)  z_target=x86_64-unknown-linux-musl; c_target=linux_amd64 ;;
  Linux-aarch64) z_target=aarch64-unknown-linux-musl; c_target=linux_arm64 ;;
  *) echo "unsupported platform $os-$arch" >&2; exit 1 ;;
esac

need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)" >&2; exit 1; }; }
need node "install Node 22.18+ (https://nodejs.org)"
need pnpm "corepack enable && corepack prepare pnpm@latest --activate"
need curl "system package manager"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<18)){console.error("Node 22.18+ required (native TypeScript)");process.exit(1)}'
command -v claude >/dev/null || echo "warning: Claude Code CLI (claude) not found; agent runs will fail until it is installed" >&2

if ! "$TOOLS/zellij" --version 2>/dev/null | grep -q "$ZELLIJ_VERSION"; then
  echo "installing zellij $ZELLIJ_VERSION"
  curl -fsSL "https://github.com/zellij-org/zellij/releases/download/v$ZELLIJ_VERSION/zellij-$z_target.tar.gz" | tar -xz -C "$TOOLS" zellij
fi
if ! "$TOOLS/caddy" version 2>/dev/null | grep -q "v$CADDY_VERSION"; then
  echo "installing caddy $CADDY_VERSION"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION/caddy_${CADDY_VERSION}_${c_target}.tar.gz" | tar -xz -C "$TOOLS" caddy
fi
if [ "$os" = Darwin ]; then xattr -d com.apple.quarantine "$TOOLS/zellij" "$TOOLS/caddy" 2>/dev/null || true; fi

"$TOOLS/zellij" --version
"$TOOLS/caddy" version

cd "$ROOT"
pnpm install
[ -f .env ] || cp .env.example .env
if [ "${1:-}" != "--no-browsers" ]; then pnpm --filter @wb/app exec playwright install chromium; fi
# code-server is optional: installed when the workspace turns it on (Settings › General › Editor).
if [ -f workspace/config.json ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync("workspace/config.json","utf8")).settings?.codeServer===true?0:1)'; then
  node packages/app/src/tools.ts install code-server
fi

echo
echo "Setup done. Next:"
echo "  pnpm start         # everything; open http://localhost:8080"
echo "The first start creates ./workspace from workspace-template/ (your config, skills and scripts)."
