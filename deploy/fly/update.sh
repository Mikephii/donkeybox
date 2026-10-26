#!/usr/bin/env bash
# Update driver for Fly, used by `wb update --via fly` (see docs/hosting/updating.md).
#   update.sh current-image        the image the app's machine runs
#   update.sh snapshot LABEL       a snapshot of the workbench_data volume
#   update.sh swap IMAGE           pins IMAGE in fly.toml and deploys it
#   update.sh manifest IMAGE       the release manifest from the image's label in its registry
# Needs flyctl signed in. FLY_APP and FLY_CONFIG (default ./fly.toml) name the app and its file.
# Reach the management API with `fly proxy 8002:8002 -a $FLY_APP` in another terminal.
set -euo pipefail
CONFIG="${FLY_CONFIG:-$PWD/fly.toml}"
APP="${FLY_APP:-$(sed -nE 's/^app *= *"([^"]+)".*/\1/p' "$CONFIG" | head -1)}"
[ -n "$APP" ] || { echo "fly: set FLY_APP or app in $CONFIG" >&2; exit 1; }

case "${1:-}" in
  current-image)
    fly machine list -a "$APP" --json | node -e 'const m=JSON.parse(require("fs").readFileSync(0,"utf8"));const c=m.find(x=>x.state==="started")??m[0];console.log(c?.config?.image??"")'
    ;;
  snapshot)
    VOL=$(fly volumes list -a "$APP" --json | node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.name==="workbench_data");console.log(v?.id??"")')
    [ -n "$VOL" ] || { echo "fly: no workbench_data volume" >&2; exit 1; }
    fly volumes snapshots create "$VOL" -a "$APP"
    ;;
  swap)
    IMAGE="${2:?swap needs an image}"
    cp "$CONFIG" "$CONFIG.before-update"
    sed -i.tmp -E "s|^( *image *= *)\"[^\"]*\"|\1\"$IMAGE\"|" "$CONFIG" && rm -f "$CONFIG.tmp"
    # Fly's own rollback does not apply to machines; wb update decides and swaps back itself.
    fly deploy -a "$APP" --config "$CONFIG" --image "$IMAGE" --strategy immediate --detach
    ;;
  manifest)
    # The image's label, read from its registry. Releases before 0.5.0 have no label: pass --manifest.
    node "$(cd "$(dirname "$0")/../.." && pwd)/packages/cli/src/wb.ts" manifest "${2:?manifest needs an image}" \
      || { echo "fly: no release label on $2; pass --manifest dist/workbench-VERSION.release.json" >&2; exit 1; }
    ;;
  *)
    echo "usage: $0 current-image | snapshot LABEL | swap IMAGE | manifest IMAGE" >&2
    exit 64
    ;;
esac
