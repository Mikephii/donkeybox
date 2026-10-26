#!/usr/bin/env bash
# Runs inside the Acme box as the workbench user (demo/acme.sh calls it).
#   box-setup.sh tools          once, for the base: Claude Code, code-server, OpenCode, the acme/shop repo
#   box-setup.sh scene THEME    every take: the people's terminals, the canvases, tickets back to the seed
set -euo pipefail
API=http://127.0.0.1:8080/api
SECRET="$(node -e 'const s=JSON.parse(require("fs").readFileSync("/data/internal/secrets.json","utf8")).secrets.PROXY_SECRET;process.stdout.write(s.value)')"
as() { local who="$1"; shift; curl -fsS -H "X-Forwarded-Email: $who@acme.dev" -H "X-Workbench-Proxy-Secret: $SECRET" -H "content-type: application/json" "$@"; }

tools() {
  wb tools install claude-code
  wb tools install code-server
  npm install -g --no-audit --no-fund opencode-ai@1 >/dev/null
  shop
}

# acme/shop, with a short history: the admin page, then PR #87 (DK-43) merged by Sam this morning.
shop() {
  local d=/data/home/shop
  rm -rf "$d"; mkdir -p "$d/test"
  commit() { local who="$1" when="$2"; shift 2
    GIT_AUTHOR_NAME="${who^}" GIT_AUTHOR_EMAIL="$who@acme.dev" GIT_COMMITTER_NAME="${who^}" GIT_COMMITTER_EMAIL="$who@acme.dev" \
    GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git -C "$d" "$@"; }
  git -C "$d" init -q -b main
  cp /demo/shop/package.json /demo/shop/orders.js /demo/shop/README.md "$d/"
  # The page before the CSV export: the marked lines removed.
  sed '/csv:start/,/csv:end/d' /demo/shop/server.js > "$d/server.js"
  printf 'node_modules\n' > "$d/.gitignore"
  git -C "$d" add -A; commit jo "2026-10-01T10:12:00+10:00" commit -q -m "Admin: orders this week"
  commit sam "2026-10-09T15:40:00+10:00" commit -q --allow-empty -m "Order history page (DK-41)"
  git -C "$d" checkout -q -b dk-43-csv-export
  cp /demo/shop/server.js /demo/shop/orders-csv.js "$d/"; cp /demo/shop/test/orders-csv.test.js "$d/test/"
  git -C "$d" add -A; commit sam "2026-10-17T09:02:00+10:00" commit -q -m "Add CSV export endpoint (DK-43)" -m "GET /orders.csv and a Download CSV button on the admin page."
  git -C "$d" checkout -q main
  commit sam "2026-10-17T09:14:00+10:00" merge -q --no-ff dk-43-csv-export -m "Merge pull request #87 from acme/dk-43-csv-export" -m "Add CSV export endpoint"
  git -C "$d" branch -q -D dk-43-csv-export
}

scene() {
  local theme="${1:-light}"
  # The box makes its standing sessions a moment after it answers; terminals made before then are lost.
  for _ in $(seq 1 60); do as alice "$API/sessions" | grep -q '"shell"' && break; sleep 1; done
  sleep 2
  # Claude Code: past its first-run screens, trusting the workspace and the shop, in the page's theme.
  node - "$theme" <<'JS'
const fs = require("fs"), f = "/data/home/.claude.json", theme = process.argv[2];
const c = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
const key = process.env.ANTHROPIC_API_KEY ?? "";
Object.assign(c, { hasCompletedOnboarding: true, theme, autoUpdates: false, numStartups: 5, tipsHistory: {}, lastReleaseNotesSeen: "99.0.0",
  customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] }, hasSeenTasksHint: true, hasUsedBackslashReturn: true });
c.projects ??= {};
for (const p of ["/data/workspace", "/data/home/shop", "/data/home"])
  c.projects[p] = { ...(c.projects[p] ?? {}), hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 5 };
fs.writeFileSync(f, JSON.stringify(c, null, 2));
JS
  # OpenCode: the box's model address (no key yet: the OpenCode clip logs in once, for everyone).
  mkdir -p /data/home/.config/opencode
  cat > /data/home/.config/opencode/opencode.json <<JSON
{ "\$schema": "https://opencode.ai/config.json", "autoupdate": false, "theme": "system", "model": "anthropic/claude-sonnet-4-5",
  "provider": { "anthropic": { "options": { "baseURL": "http://model:4999/v1" } } } }
JSON
  rm -f /data/home/.local/share/opencode/auth.json
  # The editor in the page's theme, as a person would set it.
  mkdir -p /data/internal/code-server/user/User
  node -e 'const f="/data/internal/code-server/user/User/settings.json",fs=require("fs");const s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};Object.assign(s,{"workbench.startupEditor":"none","workbench.tips.enabled":false,"telemetry.telemetryLevel":"off","workbench.colorTheme":process.argv[1]==="dark"?"Default Dark Modern":"Default Light Modern","editor.fontSize":14,"editor.minimap.enabled":false,"window.commandCenter":false});fs.writeFileSync(f,JSON.stringify(s,null,2))' "$theme"
  jira reset >/dev/null
  canvases
  # Last night's scheduled run, really run, then moved to 02:00.
  wb run --group housekeeping --prompt "/housekeeping nightly" --title "Nightly housekeeping" --print >/dev/null
  for _ in $(seq 1 60); do wb runs | grep -qE "(done|failed).*Nightly housekeeping" && break; sleep 1; done
  node /demo/history.mjs
}

term() { as "$1" -X POST "$API/terminals" -d "{\"title\":\"$2\",\"cwd\":\"$3\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).name'; }
win() { # id canvas type x y w h props [title]
  printf '{"id":"%s","canvasId":"%s","type":"%s","x":%s,"y":%s,"w":%s,"h":%s,"props":%s%s}' "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "${9:+,\"title\":\"$9\"}" > /tmp/win.json
  wb admin windows put --file /tmp/win.json >/dev/null
}

# One canvas per scene, laid out for a 1280x800 window (the recorder's, at 1.25x).
canvases() {
  for w in $(wb admin windows | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).map(w=>w.id).join(" ")'); do wb admin windows delete "$w" >/dev/null; done
  wb admin canvases delete ops >/dev/null 2>&1 || true
  wb admin canvases put work --title Work >/dev/null
  wb admin canvases put skills --title Skills >/dev/null
  wb admin canvases put shop --title Shop >/dev/null
  wb admin canvases put agents --title Agents >/dev/null
  wb admin canvases put triage --title Triage >/dev/null
  wb admin canvases put desk --title Desk >/dev/null
  wb admin canvases put together --title Together >/dev/null
  wb admin canvases put build --title Build >/dev/null
  wb admin canvases put home --title Home >/dev/null
  local alice sam kai desk home
  alice=$(term alice claude workspace)
  sam=$(term sam tests /data/home/shop)
  win work-claude work terminal 20 20 700 700 "{\"session\":\"$alice\"}"
  win work-requests work requests 740 20 440 340 '{"groups":["estimates"]}' "Estimates"
  win work-runs work runs 740 380 440 340 '{"live":false}' "Runs"
  win skills-code skills code 20 20 860 700 '{"target":"workspace"}'
  win skills-activity skills activity 900 20 280 700 '{}'
  win shop-tests shop terminal 20 20 600 700 "{\"session\":\"$sam\"}"
  win shop-preview shop preview 640 20 540 420 '{"port":3000,"path":"/"}' "shop-web"
  win shop-services shop services 640 460 540 260 '{}'
  win triage-requests triage requests 20 20 560 340 '{"groups":[]}' "Needs a person"
  win triage-runs triage runs 20 380 560 340 '{"live":false}' "Runs"
  win triage-activity triage activity 600 20 580 700 '{}'
  sam=$(term sam opencode /data/home/shop)
  kai=$(term kai opencode /data/home/shop)
  win agents-sam agents terminal 20 20 575 700 "{\"session\":\"$sam\"}"
  win agents-kai agents terminal 605 20 575 700 "{\"session\":\"$kai\"}"
  # Alice's own Claude at her desk: a skill run by hand opens what it did beside it (wb open).
  desk=$(term alice claude workspace)
  win desk-claude desk terminal 20 20 600 700 "{\"session\":\"$desk\"}"
  # The same canvas in four browsers: a shared shell, the Inbox and the runs.
  win together-term together terminal 20 20 640 700 '{"session":"shell"}' "Shell"
  win together-requests together requests 680 20 500 340 '{"groups":[]}' "Needs a person"
  win together-runs together runs 680 380 500 340 '{"live":false}' "Runs"
  # The landing page's first picture: Claude Code, the editor and the runs, small gaps between.
  home=$(term alice claude workspace)
  win home-claude home terminal 20 20 580 660 "{\"session\":\"$home\"}" "Claude Code"
  win home-code home code 620 20 560 360 '{"target":"workspace"}'
  win home-runs home runs 620 400 560 280 '{"live":false}' "Runs"
  # Alice's Claude (the Work canvas's session) beside the workspace and the runs.
  win build-claude build terminal 20 20 700 700 "{\"session\":\"$alice\"}"
  win build-code build code 740 20 440 440 '{"target":"workspace"}'
  win build-runs build runs 740 480 440 240 '{"live":false}' "Runs"
}

case "${1:-}" in
  tools) tools ;;
  scene) scene "${2:-light}" ;;
  *) echo "usage: box-setup.sh tools | scene [light|dark]"; exit 1 ;;
esac
