#!/usr/bin/env bash
# Update driver for deploy/compose, used by `wb update --via compose` (see docs/hosting/updating.md).
#   update.sh current-image        the image .env pins
#   update.sh snapshot LABEL       none for a local volume (the box's own backup covers it); exits 1
#   update.sh swap IMAGE           pins IMAGE in .env and recreates only the workbench container
#   update.sh manifest IMAGE       the release manifest baked into IMAGE
# Run it from the folder with docker-compose.yml and .env, or set WB_COMPOSE_DIR.
set -euo pipefail
DIR="${WB_COMPOSE_DIR:-$PWD}"
ENV_FILE="$DIR/.env"
compose() { docker compose --project-directory "$DIR" "$@"; }

case "${1:-}" in
  current-image)
    grep -E '^WORKBENCH_IMAGE=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"
    ;;
  snapshot)
    echo "compose: a local Docker volume has no snapshots; the box's backup in /data/internal/backups covers the database, config and secrets" >&2
    exit 1
    ;;
  swap)
    IMAGE="${2:?swap needs an image}"
    # Pull from a registry when it is one; an image built here is used as it is.
    docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE"
    cp "$ENV_FILE" "$ENV_FILE.before-update"
    if grep -qE '^WORKBENCH_IMAGE=' "$ENV_FILE"; then
      sed -i.tmp -E "s|^WORKBENCH_IMAGE=.*|WORKBENCH_IMAGE=$IMAGE|" "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
    else
      echo "WORKBENCH_IMAGE=$IMAGE" >> "$ENV_FILE"
    fi
    compose up -d --no-deps workbench
    ;;
  manifest)
    # The image's label (locally or from its registry); releases before 0.5.0 only have the file inside.
    node "$(cd "$(dirname "$0")/../.." && pwd)/packages/cli/src/wb.ts" manifest "${2:?manifest needs an image}" 2>/dev/null \
      || docker run --rm --entrypoint cat "$2" /opt/workbench/release.json
    ;;
  *)
    echo "usage: $0 current-image | snapshot LABEL | swap IMAGE | manifest IMAGE" >&2
    exit 64
    ;;
esac
