#!/usr/bin/env bash
# Update driver for the deploy/gcp module, used by `wb update --via gcp` (see docs/hosting/updating.md).
#   update.sh current-image        the image the tfvars file pins
#   update.sh snapshot LABEL       a snapshot of the box's data disk
#   update.sh swap IMAGE           pins IMAGE in the tfvars file and applies (the VM is replaced, the disk kept)
#   update.sh manifest IMAGE       read with docker when the image is pullable here, else exits 1
# Settings (environment):
#   WB_TF_DIR        the Terraform root that uses the module (default: current folder)
#   WB_TF_VARS_FILE  the tfvars file holding the image (default: $WB_TF_DIR/terraform.tfvars)
#   WB_TF_IMAGE_VAR  the variable's name in that file (default: image)
#   WB_GCP_PROJECT, WB_GCP_ZONE, WB_GCP_DISK   for snapshots (the module names the disk <name>-data)
#   WB_TF_AUTO_APPROVE=1   apply without Terraform's prompt
# Reach the management API with an IAP tunnel in another terminal:
#   gcloud compute start-iap-tunnel <name>-vm 8002 --local-host-port=localhost:8002 --zone <zone>
set -euo pipefail
TF_DIR="${WB_TF_DIR:-$PWD}"
VARS="${WB_TF_VARS_FILE:-$TF_DIR/terraform.tfvars}"
VAR="${WB_TF_IMAGE_VAR:-image}"

case "${1:-}" in
  current-image)
    sed -nE "s/^ *$VAR *= *\"([^\"]+)\".*/\1/p" "$VARS" | head -1
    ;;
  snapshot)
    [ -n "${WB_GCP_DISK:-}" ] && [ -n "${WB_GCP_ZONE:-}" ] || { echo "gcp: set WB_GCP_DISK and WB_GCP_ZONE to snapshot the data disk" >&2; exit 1; }
    gcloud compute disks snapshot "$WB_GCP_DISK" --zone "$WB_GCP_ZONE" ${WB_GCP_PROJECT:+--project "$WB_GCP_PROJECT"} \
      --snapshot-names "${WB_GCP_DISK}-${2:-before-update}-$(date +%Y%m%d%H%M%S)" | sed 's/^/gcp: /' >&2
    ;;
  swap)
    IMAGE="${2:?swap needs an image}"
    grep -qE "^ *$VAR *=" "$VARS" || { echo "gcp: $VARS has no $VAR = \"...\" line" >&2; exit 1; }
    cp "$VARS" "$VARS.before-update"
    sed -i.tmp -E "s|^( *$VAR *= *)\"[^\"]*\"|\1\"$IMAGE\"|" "$VARS" && rm -f "$VARS.tmp"
    terraform -chdir="$TF_DIR" apply -var-file="$VARS" ${WB_TF_AUTO_APPROVE:+-auto-approve}
    ;;
  manifest)
    # The image's label (locally or from its registry); releases before 0.5.0 only have the file inside.
    node "$(cd "$(dirname "$0")/../.." && pwd)/packages/cli/src/wb.ts" manifest "${2:?manifest needs an image}" 2>/dev/null && exit 0
    command -v docker >/dev/null || exit 1
    docker run --rm --entrypoint cat "$2" /opt/workbench/release.json
    ;;
  *)
    echo "usage: $0 current-image | snapshot LABEL | swap IMAGE | manifest IMAGE" >&2
    exit 64
    ;;
esac
