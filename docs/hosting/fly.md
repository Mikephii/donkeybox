---
title: "One Fly Machine"
description: "The image on a single Fly Machine with a volume and the box's own OIDC sign-in."
---

The image on a single Fly Machine with a Fly volume, signing people in with the box's own OIDC
sign-in. `deploy/fly/fly.toml` is the starting point.

## 1. What you get

- **Identity mode** `oidc`. The box sends people to your identity provider (Google, Microsoft
  Entra, Okta, Auth0, Keycloak) and keeps a signed session cookie.
- **The box** is one Fly Machine running the image, with Fly's edge terminating TLS.
- **Webhooks** arrive on the same host under `/hooks/...`. They need no sign-in and are checked by
  each source's own secret.
- **Persistence** on a Fly volume mounted at `/data`. Fly snapshots volumes daily.

## 2. Security

What the door verifies. Every API call needs the box's session cookie, which the box signs with a
key kept on the volume. Sign-in checks the ID token's signature against the provider's keys, its
issuer, audience and nonce, and refuses unverified emails. Terminals, canvases, previews and the
editor ask the same check before Caddy lets a request through.

What can reach the box. Fly's edge on 443, which forwards to port 8080. Port 8002 (management) is
reachable only over your Fly private network, and only when you set `WB_MANAGEMENT_TOKEN`.

How secrets are stored. In the volume's secrets file, mode 600. The OIDC client secret can live
there or in `fly secrets` (the box falls back to environment variables of the same name).

What people on the list can do. Everyone who signs in can open a shell on the machine and read
every token on it. Viewers get watch-only terminals.

What stays outside. Nothing: the allow list is Settings › People. With an empty list only
`WB_BOOTSTRAP_ADMIN` gets in, so a public provider like Google never admits strangers.

Threats, briefly:

- **The OIDC client secret leaks.** Rotate it at the provider and with `fly secrets set`.
- **A hooks secret leaks.** Rotate it on the Secrets page and update the sender.
- **The volume is lost.** Restore from a Fly snapshot (section 6).

## 3. Users

- **Add people or domains** in Settings › People. Remove them there; they are locked out on their
  next request.
- **Sign-ins last** `auth.oidc.sessionHours` (default 168).
- **Terminal tokens** are revoked within seconds of someone being removed or made a viewer.
- **Read-only terminals** come with the viewer role.

## 4. Provision

Create an OAuth client at your provider with the redirect URL
`https://<app>.fly.dev/auth/callback`. Then:

```sh
cp deploy/fly/fly.toml . && $EDITOR fly.toml      # app name, region, image, issuer, client id, admin
fly launch --no-deploy --copy-config
fly volumes create workbench_data --size 20 --region <region>
fly secrets set OIDC_CLIENT_SECRET=<from your provider>
fly deploy
```

`performance-2x` with 8 GB is a comfortable size for a few people and a handful of concurrent runs.

## 5. First boot

Open `https://<app>.fly.dev` and sign in as the bootstrap admin. Follow the Setup page: install
Claude Code with `wb tools install claude-code` in a terminal and sign it in (with a key or seat
permitted for shared use), generate a webhook secret, send a test
delivery, create a workflow, and give the box's config repo a remote.

## 6. Updating, backing up and restoring

**Update.** Run `fly proxy 8002:8002 -a <app>` in one terminal, then
`wb update --to <version> --via fly --manifest dist/workbench-<version>.release.json` in another,
from the folder with `fly.toml`. It drains the box, backs it up, snapshots the volume, pins the new
image in `fly.toml`, deploys it, and puts the old image back if the new one is not healthy. See
[updating.md](updating.md).

**Back up.** Fly snapshots the volume daily and keeps snapshots for five days by default. Before an
update, take one with `fly volumes snapshots create <volume-id>`.

**Restore.** `fly volumes create workbench_data --snapshot-id <id> --region <region>`, then deploy
so the machine mounts the new volume. Without a snapshot, start fresh and restore the box's config from its remote.

**Sleep.** The example keeps the machine running. To let it stop when idle, set
`auto_stop_machines = "stop"`, switch schedules to an outside scheduler (Settings › General ›
Schedules) and have that scheduler call `/hooks/_schedule/<source>`; a webhook or a visit wakes the
machine, and runs that were live come back as interrupted with a Resume button.

## 7. Checklist

- [ ] The OIDC client's redirect URL is exactly `https://<app>.fly.dev/auth/callback`.
- [ ] A private window on the app is sent to the provider's sign-in.
- [ ] `WB_BOOTSTRAP_ADMIN` is your email, and Settings › People lists your team or domain.
- [ ] The Setup page shows `/data` as a mounted volume.
- [ ] Claude Code is signed in with a key or seat permitted for shared use.
- [ ] Each webhook source has a generated secret and a test delivery was accepted.
- [ ] `fly volumes snapshots list` shows a recent snapshot.
- [ ] The box's config repo has a remote of its own and the last push succeeded.
- [ ] Port 8002 is not in any public `[[services]]` block.

Last walked through: not yet verified on a fresh host (product 0.3.0). The OIDC sign-in is covered
by unit tests against a local issuer; this guide has not been run on Fly.
