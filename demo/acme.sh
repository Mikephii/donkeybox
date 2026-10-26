#!/usr/bin/env bash
# The Acme demo box: the real image, a stock bash shell, the Acme workspace and a scripted model.
#   demo/acme.sh up [light|dark]   build the base once (tools, shop repo), then start a fresh box from it
#   demo/acme.sh reset [THEME]     throw the box's data away and start again from the base
#   demo/acme.sh down              stop everything (keeps the base)
#   demo/acme.sh purge             stop everything and delete the base too
#   demo/acme.sh hook-merged [N TITLE BRANCH WHO]   GitHub says acme/shop #N merged (default #87)
#   demo/acme.sh ticket WHO "SUMMARY" ["DESCRIPTION"]   Jira gets a new ticket from WHO and tells the box
#   demo/acme.sh exec CMD...       run a command in the box as the workbench user
# The box is on http://localhost:${ACME_PORT:-8090}. Sign-in is the proxy mode: a browser (or the
# recorder) sends X-Forwarded-Email and the proxy secret below, so any @acme.dev person can open it.
set -euo pipefail
DEMO="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${ACME_IMAGE:-donkeybox/workbench:demo}"
PORT="${ACME_PORT:-8090}"
NET=acme-demo BOX=acme-box MODEL=acme-model BASE=acme-base DATA=acme-data
PROXY_SECRET=acme-demo-proxy-secret
HOOK_SECRET=acme-demo-github-secret
JIRA_SECRET=acme-demo-jira-secret
# The box's one model credential. With the scripted model it is a placeholder; DEMO_MODEL=real
# ANTHROPIC_API_KEY=... uses a real key and forwards every call to the real API.
API_KEY="${ANTHROPIC_API_KEY:-sk-ant-api03-acme-demo-key-000000000000000000000000}"
THEME="${2:-light}"
x() { docker exec -u workbench "$BOX" bash -lc "$*"; }
xi() { docker exec -i -u workbench "$BOX" bash -lc "$*"; }

certs() {
  local d="$DEMO/model/certs"
  [ -f "$d/mcp.pem" ] && return
  mkdir -p "$d"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Acme demo CA" -keyout "$d/ca-key.pem" -out "$d/ca.pem" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=mcp.atlassian.com" -keyout "$d/mcp-key.pem" -out "$d/mcp.csr" 2>/dev/null
  printf 'subjectAltName=DNS:mcp.atlassian.com\n' > "$d/ext.cnf"
  openssl x509 -req -in "$d/mcp.csr" -CA "$d/ca.pem" -CAkey "$d/ca-key.pem" -CAcreateserial -days 3650 -extfile "$d/ext.cnf" -out "$d/mcp.pem" 2>/dev/null
}

model() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  docker rm -f "$MODEL" >/dev/null 2>&1 || true
  docker run -d --name "$MODEL" --network "$NET" --network-alias model --network-alias mcp.atlassian.com \
    -e DEMO_MODEL="${DEMO_MODEL:-}" -v "$DEMO:/demo:ro" node:24-bookworm-slim node /demo/model/server.ts >/dev/null
}

start() {
  docker rm -f "$BOX" >/dev/null 2>&1 || true
  docker run -d --name "$BOX" --hostname acme --network "$NET" -p "$PORT:8080" -v "$DATA:/data" -v "$DEMO:/demo:ro" \
    -e AUTH_MODE=proxy -e WB_TEMPLATE_DIR=/demo/workspace -e TZ=Australia/Sydney \
    -e WB_SEED_PUBLIC_HOOKS_URL=https://hooks.acme.dev -e WB_SEED_PUBLIC_APP_URL=https://acme.donkeybox.dev \
    -e ANTHROPIC_BASE_URL=http://model:4999 -e ANTHROPIC_API_KEY="$API_KEY" \
    -e NODE_EXTRA_CA_CERTS=/demo/model/certs/ca.pem -e DISABLE_AUTOUPDATER=1 -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    ${ACME_DOCKER_ARGS:-} "$IMAGE" >/dev/null
  for _ in $(seq 1 90); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return; sleep 1; done
  docker logs --tail 40 "$BOX"; echo "the box did not come up" >&2; exit 1
}

secrets() {
  printf '%s' "$PROXY_SECRET" | xi wb secrets set PROXY_SECRET >/dev/null
  printf '%s' "$HOOK_SECRET" | xi wb secrets set GITHUB_WEBHOOK_SECRET >/dev/null
}

base() {
  docker volume inspect "$BASE" >/dev/null 2>&1 && return
  echo "building the base (tools, shop repo); this takes a few minutes once"
  docker volume create "$DATA" >/dev/null
  start
  secrets
  x bash /demo/box-setup.sh tools
  docker stop "$BOX" >/dev/null
  # Each take makes the workspace afresh from demo/workspace, the way a new box does from its template.
  docker run --rm -v "$DATA:/data" alpine sh -c 'rm -rf /data/workspace && mkdir /data/workspace && chown 1000:1000 /data/workspace' 
  docker volume create "$BASE" >/dev/null
  docker run --rm -v "$DATA:/from" -v "$BASE:/to" alpine sh -c 'cp -a /from/. /to/'
}

fresh() {
  docker rm -f "$BOX" >/dev/null 2>&1 || true
  docker volume rm "$DATA" >/dev/null 2>&1 || true
  docker volume create "$DATA" >/dev/null
  docker run --rm -v "$BASE:/from" -v "$DATA:/to" alpine sh -c 'cp -a /from/. /to/'
  start
  x "printf %s $JIRA_SECRET | wb secrets set JIRA_HOOK_SECRET 2>/dev/null || printf %s $JIRA_SECRET | wb secrets rotate JIRA_HOOK_SECRET" >/dev/null
  x bash /demo/box-setup.sh scene "$THEME"
  echo "Acme is up on http://localhost:$PORT ($THEME)"
}

case "${1:-}" in
  up) certs; model; base; fresh ;;
  reset) model; fresh ;;
  down) docker rm -f "$BOX" "$MODEL" >/dev/null 2>&1 || true ;;
  purge) docker rm -f "$BOX" "$MODEL" >/dev/null 2>&1 || true; docker volume rm "$DATA" "$BASE" >/dev/null 2>&1 || true ;;
  exec) shift; x "$@" ;;
  hook-merged)
    N="${2:-87}" TITLE="${3:-Add CSV export endpoint}" REF="${4:-dk-43-csv-export}" WHO="${5:-sam}"
    BODY=$(node -e 'const [n,t,r,w]=process.argv.slice(1);console.log(JSON.stringify({action:"closed",number:+n,pull_request:{number:+n,title:t,merged:true,html_url:`https://github.com/acme/shop/pull/${n}`,user:{login:w},merged_by:{login:w},head:{ref:r},base:{ref:"main"}},repository:{full_name:"acme/shop",name:"shop"},sender:{login:w}}))' "$N" "$TITLE" "$REF" "$WHO")
    SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$HOOK_SECRET" -hex | sed 's/^.* //')"
    curl -sS -X POST "http://127.0.0.1:$PORT/hooks/github" -H "content-type: application/json" -H "X-GitHub-Event: pull_request" \
      -H "X-GitHub-Delivery: acme-$N-$(date +%s)" -H "X-Hub-Signature-256: $SIG" --data "$BODY"; echo ;;
  ticket)
    KEY=$(x "jira create $(printf %q "$3") --type Story --reporter $(printf %q "$2") ${4:+--description $(printf %q "$4")}" | awk '{print $2}')
    BODY=$(node -e 'const [k,s,w]=process.argv.slice(1);console.log(JSON.stringify({webhookEvent:"jira:issue_created",user:{displayName:w},issue:{key:k,fields:{summary:s,issuetype:{name:"Story"},status:{name:"To Do"},reporter:{displayName:w}}}}))' "$KEY" "$3" "$2")
    curl -sS -o /dev/null -X POST "http://127.0.0.1:$PORT/hooks/jira/$JIRA_SECRET" -H "content-type: application/json" --data "$BODY"
    echo "$KEY" ;;
  *) sed -n 2,11p "$0"; exit 1 ;;
esac
