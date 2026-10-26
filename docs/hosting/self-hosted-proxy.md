---
title: "Any Linux host behind a sign-in proxy"
description: "The compose file on any Linux host with Docker, behind a sign-in proxy."
---

The compose file in `deploy/compose` runs the workbench on any Linux host with Docker, behind
oauth2-proxy. The same box works behind Cloudflare Access, Pomerium or Tailscale Serve instead.

## 1. What you get

- **Identity mode** `proxy`. A sign-in proxy is the door. It signs people in and tells the box who
  they are in a header.
- **The box** is one container with everything in it, plus the proxy. The app's own port is never
  published; only the proxy reaches it.
- **Webhooks** arrive at the hooks door on port 8081, which accepts only `POST /hooks/...`.
  Publish that port, or expose it with Cloudflare Tunnel or Tailscale Funnel.
- **Persistence** in the `workbench-data` Docker volume: the box's config, the workbench's own database, secrets and keys,
  the box user's home and installed tools.

## 2. Security

What the door verifies. The proxy signs people in with your identity provider. The app then
believes the proxy's email header only with proof that the request came from the proxy:

- **A shared secret.** The proxy adds `X-Workbench-Proxy-Secret`; the app compares it with the
  `PROXY_SECRET` value in its secrets store. Use this whenever the proxy can add a header.
- **The proxy's address.** The app accepts the header from addresses in `auth.proxy.trustedCidrs`.
  The compose file pins oauth2-proxy to `172.31.250.10` and trusts only that address.

Without either, the app lets nobody in. A header from anywhere else gets a 401, even with a valid
email in it.

What each proxy sends:

| Proxy | Email header (`auth.proxy.emailHeader`) | Proof |
|---|---|---|
| oauth2-proxy | `X-Forwarded-Email` | fixed address on the compose network |
| Cloudflare Access | `Cf-Access-Authenticated-User-Email` | a Transform Rule adding `X-Workbench-Proxy-Secret` |
| Pomerium | `X-Pomerium-Claim-Email` (with `pass_identity_headers`) | `set_request_headers` adding `X-Workbench-Proxy-Secret` |
| Tailscale Serve | `Tailscale-User-Login` | the address Serve connects from (it cannot add headers) |

What can reach the box. Only the proxy reaches the app door. The hooks door is public on purpose.
Keep every other port closed with the host's firewall.

How secrets are stored. In `/data/internal/secrets.json` in the volume, mode 600. Values never go
into config.json or git.

What people on the list can do. Everyone the proxy lets in can open a shell in the container. From
that shell they can read every token the box holds, including the proxy secret, so roles are guard
rails for the UI rather than a wall between members and admins. Viewers are different: they get
watch-only terminals and cannot change anything.

What stays outside. The proxy's own policy (which accounts may sign in at all).

Threats, briefly:

- **The app port is published by mistake.** Requests that skip the proxy carry no secret and come
  from the wrong address, so the app refuses them.
- **The proxy secret leaks.** Rotate `PROXY_SECRET` on the Secrets page (or the management API) and
  update the proxy. Until then, anyone who can reach the app port directly could claim any email.
- **A hooks secret leaks.** Rotate it on the Secrets page and update the sender.
- **The host disk dies.** Restore the volume from backup (section 6).

## 3. Users

- **The proxy decides who may sign in.** For oauth2-proxy, `ALLOWED_EMAIL_DOMAINS` in `.env`; for
  Cloudflare Access and Pomerium, their policies; for Tailscale, your tailnet.
- **The box decides roles.** With an empty Settings › People list, everyone the proxy admits is a
  member. Once you list people or domains, only they get in, with their roles.
- **Sign-ins last** as long as the proxy's session (oauth2-proxy: 168 hours by default).
- **Terminal tokens** are revoked within seconds of someone being removed or made a viewer.
- **Read-only terminals** come with the viewer role.

## 4. Provision

On the host, with Docker and the compose plugin installed:

```sh
cp -r deploy/compose /opt/workbench && cd /opt/workbench
cp .env.example .env
# Fill in: WORKBENCH_IMAGE, APP_URL, HOOKS_URL, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
# COOKIE_SECRET (openssl rand -base64 32 | head -c 32), ALLOWED_EMAIL_DOMAINS, BOOTSTRAP_ADMIN
docker compose up -d
```

At your identity provider, register `<APP_URL>/oauth2/callback` as the redirect URL.

TLS. Either put your own TLS terminator in front of `127.0.0.1:4180` (door) and port 8081 (hooks),
or let the bundled Caddy fetch certificates with `docker compose --profile tls up -d` after setting
`APP_DOMAIN` and `HOOKS_DOMAIN` and pointing both at the host.

**Cloudflare Access instead of oauth2-proxy.** Remove the `oauth2-proxy` service and run
`cloudflared` with a tunnel to `http://workbench:8080`. In Cloudflare Zero Trust, create an Access
application for the app domain and a Transform Rule that sets `X-Workbench-Proxy-Secret` to a value
you generate on the box (Secrets page, `PROXY_SECRET`). Set `auth.proxy.emailHeader` to
`Cf-Access-Authenticated-User-Email` and clear `trustedCidrs` in Settings › Doors and sign-in.
Expose the hooks door with a second tunnel hostname to `http://workbench:8081`, with no Access policy.

**Pomerium.** Route the app domain to `http://workbench:8080` with `pass_identity_headers: true`
and `set_request_headers: { X-Workbench-Proxy-Secret: <value> }`, and set the email header to
`X-Pomerium-Claim-Email`.

**Tailscale Serve.** Publish 8080 on `127.0.0.1` only, run `tailscale serve --bg 8080`, set the
email header to `Tailscale-User-Login`, and trust the Docker bridge gateway (usually
`172.17.0.1/32`, see `docker network inspect bridge`). Anyone with a shell on the host could forge
that header, so use this only on a host where that is already true. Expose hooks with
`tailscale funnel --bg 8081`.

## 5. First boot

Open the app URL and sign in. Then follow the Setup page: install and sign in Claude Code in a
terminal (with a key or seat permitted for shared use), generate a
webhook secret, send a test delivery, create a workflow, and give the box's config repo a remote.

## 6. Updating, backing up and restoring

**Update.** On the host, in the compose folder, with `MANAGEMENT_TOKEN` set in `.env`, run
`WB_MANAGEMENT_TOKEN=<token> node <release>/packages/cli/src/wb.ts update --to <version> --via compose`
(the unpacked release tarball and Node 22.18 or newer are all it needs). It drains the box, backs it
up, pins the new image in `.env`, recreates only the workbench container, and puts the old image back
if the new one is not healthy. See [updating.md](updating.md) for every step and for doing it by hand.

**Back up.** Stop the stack for a consistent copy, or rely on SQLite's WAL and copy while running:

```sh
docker compose stop workbench
docker run --rm -v workbench_workbench-data:/data -v "$PWD":/backup debian:bookworm-slim \
  tar -czf /backup/workbench-$(date +%F).tar.gz -C /data .
docker compose start workbench
```

**Restore.** Create the volume, unpack the archive into it, start the stack:

```sh
docker compose down
docker volume create workbench_workbench-data
docker run --rm -v workbench_workbench-data:/data -v "$PWD":/backup debian:bookworm-slim \
  tar -xzf /backup/workbench-2026-10-16.tar.gz -C /data
docker compose up -d
```

**Lost host and no backup.** Start fresh and restore the box's config from its remote:
config, skills and scripts come back; sign-ins, secrets and history do not.

## 7. Checklist

- [ ] Only the proxy can reach port 8080; `docker compose ps` shows 8080 unpublished.
- [ ] A request to the app with a forged email header from another container gets 401.
- [ ] The hooks door answers `GET /api/me` with 404 and accepts a signed test delivery.
- [ ] A private window on the app URL is sent to sign in.
- [ ] The proxy only admits your organisation's accounts.
- [ ] Settings › People has an admin and lists your team or domain.
- [ ] Claude Code is signed in with a key or seat permitted for shared use.
- [ ] TLS is in front of both doors.
- [ ] A volume backup ran and was restored once somewhere else.
- [ ] The box's config repo has a remote of its own and the last push succeeded.

Last walked through: not yet verified on a fresh host (product 0.3.0). The oauth2-proxy route was
walked through on 2026-10-16 on Docker Desktop (macOS) with a stand-in OIDC issuer: sign-in, the
canvas and a terminal through the proxy, a forged header from another container refused, and a
signed webhook through the hooks door.
