# syntax=docker/dockerfile:1
# The whole box in one image: app, Yjs, webhook listener, Zellij web, Caddy, standing sessions and,
# when switched on, code-server. The supervisor is the entrypoint. Everything that changes lives on
# the /data volume; replace the container freely.
#   docker build -t workbench .
#   docker run -p 8080:8080 -v workbench-data:/data -e AUTH_MODE=proxy ... workbench
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG WB_VERSION=dev
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 make g++ \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /opt/workbench
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json versions.json ./
COPY packages/app/package.json packages/app/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY packages/hooks/package.json packages/hooks/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @wb/app build \
  && pnpm install --frozen-lockfile --prod --config.confirmModulesPurge=false \
  && WB_VERSION=$WB_VERSION node packages/app/src/release.ts > release.json
# Zellij and Caddy are part of the product: pinned, baked into the image.
RUN WB_TOOLS_DIR=/opt/workbench/.tools node packages/app/src/tools.ts install zellij \
  && WB_TOOLS_DIR=/opt/workbench/.tools node packages/app/src/tools.ts install caddy \
  && rm -rf packages/app/web packages/app/e2e packages/app/test /root/.cache /root/.local/share/pnpm

FROM node:${NODE_VERSION}-bookworm-slim
ARG WB_VERSION=dev
# The release manifest, compact JSON, computed by scripts/release.sh from the same source as
# /opt/workbench/release.json; `wb manifest IMAGE` and the update drivers read it from the registry.
ARG WB_RELEASE=""
LABEL org.opencontainers.image.title="workbench" \
      org.opencontainers.image.version="${WB_VERSION}" \
      org.opencontainers.image.source="https://github.com/mikephii/donkeybox" \
      org.opencontainers.image.licenses="MIT" \
      org.donkeybox.release="${WB_RELEASE}"
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client tini bash less procps util-linux locales vim-tiny \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
  && userdel -r node \
  && useradd -u 1000 -U -d /data/home -M -s /bin/bash workbench \
  && mkdir -p /data && chown workbench:workbench /data \
  && printf 'export PATH=/data/tools/bin:/opt/workbench/.tools/bin:/opt/workbench/packages/cli/bin:/data/workspace/bin:$PATH\nexport NPM_CONFIG_PREFIX=/data/tools\n' > /etc/profile.d/workbench.sh
COPY --from=build --chown=root:root /opt/workbench /opt/workbench
ENV WB_VERSION=${WB_VERSION} \
    WB_PRODUCT_DIR=/opt/workbench \
    WB_DATA_DIR=/data/internal \
    WB_WORKSPACE_DIR=/data/workspace \
    WB_TOOLS_DIR=/data/tools \
    WB_EXPECT_DATA_MOUNT=1 \
    WB_MODE=prod \
    NODE_ENV=production \
    HOME=/data/home \
    SHELL=/bin/bash \
    NPM_CONFIG_PREFIX=/data/tools \
    LANG=en_US.UTF-8 \
    PATH=/data/tools/bin:/opt/workbench/.tools/bin:/opt/workbench/packages/cli/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
VOLUME /data
# 8080: the app door (and webhooks unless WB_HOOKS_DOOR_PORT is set). 8002: management API (private network only).
EXPOSE 8080 8002
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/workbench/deploy/image/entrypoint.sh"]
