#!/usr/bin/env bash
# Builds a release: the container image tagged with the version, its release manifest, and a source
# tarball. With --push, builds for linux/amd64 and linux/arm64 and pushes both tags to the registry.
#   scripts/release.sh [VERSION]                 # local image for this machine; nothing pushed
#   scripts/release.sh --push [VERSION]          # multi-arch, pushes IMAGE:VERSION and IMAGE:latest
#   IMAGE=ghcr.io/mikephii/donkeybox scripts/release.sh --push 0.5.0
# VERSION defaults to package.json's. Pushing needs `docker login ghcr.io` (CI uses GITHUB_TOKEN).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PUSH=0
if [ "${1:-}" = "--push" ]; then PUSH=1; shift; fi
PKG_VERSION="$(node -p 'require("./package.json").version')"
VERSION="${1:-$PKG_VERSION}"
[ "$VERSION" = "$PKG_VERSION" ] || { echo "package.json says $PKG_VERSION; bump it first so the box reports the right version" >&2; exit 1; }
IMAGE="${IMAGE:-ghcr.io/mikephii/donkeybox}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

node packages/app/src/schema.ts >/dev/null
node scripts/third-party-notices.ts >/dev/null

# The manifest from source, compact, for the image label. The build writes the same thing to
# /opt/workbench/release.json; the check below fails the release if the two ever differ.
RELEASE_JSON="$(WB_VERSION="$VERSION" node -e 'import("./packages/app/src/release.ts").then(m=>process.stdout.write(JSON.stringify(m.releaseManifest())))')"

BUILD_ARGS=(--build-arg "WB_VERSION=$VERSION" --build-arg "WB_RELEASE=$RELEASE_JSON")
if [ "$PUSH" = 1 ]; then
  # Fly and most clouds run amd64; Apple silicon and Graviton run arm64.
  docker buildx build --platform "$PLATFORMS" "${BUILD_ARGS[@]}" -t "$IMAGE:$VERSION" -t "$IMAGE:latest" --push .
  # A local copy for this machine, for the checks and the manifest file below.
  docker pull -q "$IMAGE:$VERSION" >/dev/null
else
  docker build "${BUILD_ARGS[@]}" -t "$IMAGE:$VERSION" .
fi

mkdir -p dist
# The release manifest (version, schema, compat floor, oldest release that may upgrade to it), the
# same as /opt/workbench/release.json in the image and its org.donkeybox.release label.
MANIFEST="dist/workbench-$VERSION.release.json"
docker run --rm --entrypoint cat "$IMAGE:$VERSION" /opt/workbench/release.json > "$MANIFEST"
LABEL_JSON="$(node packages/cli/src/wb.ts manifest "$IMAGE:$VERSION")"
node -e '
  const [a, b] = [JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), JSON.parse(process.argv[2])];
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("the image label and release.json differ:\n", a, "\n", b); process.exit(1); }
' "$MANIFEST" "$LABEL_JSON"
cp "$MANIFEST" release.json
trap 'rm -f "$ROOT/release.json"' EXIT
# GNU tar renames with --transform, BSD tar (macOS) with -s.
if tar --version | grep -q bsdtar; then RENAME="-s ,^\.,workbench-$VERSION,"; else RENAME="--transform s,^\.,workbench-$VERSION,"; fi
TAR="dist/workbench-$VERSION.tar.gz"
tar --exclude=node_modules --exclude=./data --exclude=./workspace --exclude=./.tools --exclude=./.env \
    --exclude=./dist --exclude='*/dist' --exclude=test-results --exclude=playwright-report --exclude='.terraform*' \
    --exclude=./.git --exclude=./apps --exclude='*/.react-router' --exclude='*/build' \
    -czf "$TAR" $RENAME .
echo
echo "image   $IMAGE:$VERSION$([ "$PUSH" = 1 ] && echo " (pushed, $PLATFORMS, also :latest)")"
echo "tarball $TAR ($(du -h "$TAR" | cut -f1))"
echo "release $MANIFEST: $(node -e 'const m=require("./'"$MANIFEST"'");console.log(`schema ${m.schemaVersion}, compat floor ${m.compatFloor}, upgrades from ${m.minUpgradeFrom}`)')"
[ "$PUSH" = 1 ] || echo "push:   scripts/release.sh --push $VERSION"
