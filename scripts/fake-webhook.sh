#!/usr/bin/env bash
# Sends a signed GitHub "pull_request closed+merged" webhook to the local hooks listener.
#   scripts/fake-webhook.sh [PR_NUMBER] [TITLE]
# Uses GITHUB_WEBHOOK_SECRET from the secrets store, else .env (the same order the listener uses). Set WB_HOOKS_URL to target Caddy instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
# The secrets store wins over the environment, exactly as the listener resolves it.
STORED="$(node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).secrets.GITHUB_WEBHOOK_SECRET;if(s)process.stdout.write(s.value)}catch{}' "${WB_DATA_DIR:-$ROOT/data}/secrets.json")"
SECRET="${STORED:-${GITHUB_WEBHOOK_SECRET:?set GITHUB_WEBHOOK_SECRET on the Secrets page or in .env}}"
URL="${WB_HOOKS_URL:-http://127.0.0.1:${WB_HOOKS_PORT:-9000}/hooks/github}"
NUM="${1:-$((RANDOM % 900 + 100))}"
TITLE="${2:-Fix checkout rounding}"
BODY=$(cat <<JSON
{"action":"closed","number":$NUM,"pull_request":{"number":$NUM,"title":"$TITLE","merged":true,"html_url":"https://github.com/example/shop/pull/$NUM","user":{"login":"octocat"},"merged_by":{"login":"octocat"},"head":{"ref":"fix/rounding"},"base":{"ref":"main"}},"repository":{"full_name":"example/shop","name":"shop"},"sender":{"login":"octocat"}}
JSON
)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')"
curl -sS -X POST "$URL" \
  -H "content-type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: fake-$(date +%s)-$RANDOM" \
  -H "X-Hub-Signature-256: $SIG" \
  --data "$BODY"
echo
