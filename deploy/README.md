# Deploying

| Folder | What it is | Guide |
|---|---|---|
| `image/` | The container entrypoint; the `Dockerfile` is at the repo root | every guide |
| `gcp/` | Terraform module: private VM, data disk with snapshots, HTTPS load balancer with IAP | [gcp-iap.md](../docs/hosting/gcp-iap.md) |
| `compose/` | Docker Compose with oauth2-proxy as the door, for any Linux host | [self-hosted-proxy.md](../docs/hosting/self-hosted-proxy.md), [aws.md](../docs/hosting/aws.md) |
| `fly/` | `fly.toml` for one Fly Machine with a volume | [fly.md](../docs/hosting/fly.md) |

Each platform folder has an `update.sh` driver for `wb update`
([docs/hosting/updating.md](../docs/hosting/updating.md)): it pins a new image in that platform's
own file and applies it.

Build an image, a source tarball and the release manifest with `pnpm release` (nothing is pushed). Pinned versions of
Node, Zellij, Caddy, code-server and Claude Code are in `versions.json`.
