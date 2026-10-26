---
title: "Your own computer"
description: "Run the box on a laptop or desk machine and let a few teammates in."
---

Run the box on a laptop or desk machine and let a few teammates in. This is the cheapest way to
share a box, and the one where it matters most to understand what you are sharing.

## 1. What you get

- **Identity mode** `proxy`, with Tailscale Serve or Cloudflare Access as the door.
- **The box** runs natively with `pnpm start`, under a user account made for it.
- **Webhooks** arrive through Tailscale Funnel or a Cloudflare Tunnel hostname, at the hooks door
  on port 8081, which accepts only `POST /hooks/...`.
- **Persistence** in the product folder's `data/` and `workspace/`, on your computer's disk.

## 2. Security

Read this part twice. A teammate who gets in can open a terminal, and that terminal is a shell on
your computer, as the user the box runs as. Anything that user can read, they can read: files,
browser profiles, SSH keys, cloud credentials. Agents run as that user too.

So run the box under a separate account that holds nothing else:

```sh
# macOS: System Settings › Users & Groups › Add User (Standard), e.g. "workbench".
# Linux:
sudo useradd -m -s /bin/bash workbench
```

Sign in to that account (or `sudo -iu workbench`), clone the product there, and do everything
below as that user. Do not give it admin or sudo rights.

What the door verifies. With Tailscale Serve, only people in your tailnet reach the box, and Serve
adds `Tailscale-User-Login` with their login. Serve cannot add a secret header, so the box trusts
the header from the address Serve connects from, `127.0.0.1`. That means any program on this
computer could also claim to be anyone. On an account that only runs the box, the only such
programs are the box itself and the shells you hand out, which can already read everything.
Cloudflare Access can add a shared secret header, which is the stronger choice if teammates are
outside your tailnet.

What can reach the box. Your tailnet (Serve) or Cloudflare's edge (Tunnel). With `WB_DOOR_BIND=127.0.0.1`
nothing listens on your network interfaces.

How secrets are stored. `data/secrets.json`, mode 600, inside the box user's home.

What people on the list can do. Open shells on your computer as the box user. Make watch-only
people viewers.

Threats, briefly:

- **The laptop is stolen.** Use full-disk encryption. Revoke the box's deploy key on your git host
  and rotate tokens stored on the Secrets page.
- **You close the lid.** The box sleeps with the computer. Runs that were working come back as
  interrupted, with a Resume button.
- **A hooks secret leaks.** Rotate it on the Secrets page and update the sender.

## 3. Users

- **Who gets in.** With Tailscale, people you share the machine with in the Tailscale admin
  console (or your whole tailnet). With Cloudflare, the Access policy.
- **Roles.** Settings › People. Once you list anyone, only listed people and domains get in.
- **Sign-ins** last as long as the tailnet or Access session.
- **Terminal tokens** are revoked within seconds of someone being removed or made a viewer.
- **Read-only terminals** come with the viewer role.

## 4. Provision

As the box user, with Node 22.18 or newer and pnpm:

```sh
git clone <product> workbench && cd workbench
pnpm run setup
pnpm build
cat >> .env <<'ENV'
WB_MODE=prod
WB_DOOR_BIND=127.0.0.1
AUTH_MODE=proxy
WB_HOOKS_DOOR_PORT=8081
WB_BOOTSTRAP_ADMIN=you@example.com
WB_SEED_SETTINGS={"auth":{"proxy":{"emailHeader":"Tailscale-User-Login","secret":"","trustedCidrs":["127.0.0.1/32"]}}}
ENV
pnpm start
```

`pnpm run setup` writes a dev `.env`; remove its `AUTH_MODE=dev` line so the one above applies.
`WB_MODE=prod` serves the built pages instead of a dev server, and `WB_DOOR_BIND` keeps the doors
on 127.0.0.1 so nothing on your network can reach them except through Serve or the tunnel.

**Tailscale.** Install Tailscale for the box user's machine, then:

```sh
tailscale serve --bg 8080            # the door, tailnet only, https://<machine>.<tailnet>.ts.net
tailscale funnel --bg --https=8443 8081   # webhooks, public, https://<machine>.<tailnet>.ts.net:8443
```

Set Settings › General › webhook base URL to `https://<machine>.<tailnet>.ts.net:8443`.

**Cloudflare instead.** Run `cloudflared tunnel` with two hostnames: the app hostname to
`http://127.0.0.1:8080` behind an Access application with a Transform Rule adding
`X-Workbench-Proxy-Secret` (a value you generate as `PROXY_SECRET` on the Secrets page), and the
hooks hostname to `http://127.0.0.1:8081` with no Access policy. Use
`Cf-Access-Authenticated-User-Email` as the email header and leave `trustedCidrs` empty.

To keep the box running after you log out, run `pnpm start` from a `launchd` agent (macOS) or a
`systemd --user` service with lingering enabled (Linux).

## 5. First boot

Open the Serve URL from another device on your tailnet. Follow the Setup page: sign Claude Code in
from a terminal (with a key or seat permitted for shared use),
generate a webhook secret, send a test delivery, create a workflow, and give the box's config repo a remote.

## 6. Updating, backing up and restoring

**Update.** In a terminal on the box run `wb admin drain` and `wb admin backup`, then stop the box,
unpack the new version next to the old one, move `data/` and `workspace/` across, `pnpm run setup`
and `pnpm start`. To roll back, start the old folder again; see [updating.md](updating.md#by-hand).

**Back up.** Copy `data/` and `workspace/` while the box is stopped, or let your normal backup
(Time Machine, restic) include the box user's home. Give the box's config repo a remote in Settings.

**Restore.** Put `data/` and `workspace/` back in a fresh copy of the product and start it.

## 7. Checklist

- [ ] The box runs under its own user account with no admin rights and nothing else in its home.
- [ ] Full-disk encryption is on.
- [ ] `AUTH_MODE=proxy` is set, and `dev` appears nowhere in `.env`.
- [ ] Only the people you mean to share with can reach the Serve or Access URL.
- [ ] The Funnel or tunnel hostname answers `GET /api/me` with 404.
- [ ] Settings › People has you as admin and lists everyone else with a role.
- [ ] Claude Code is signed in with a key or seat permitted for shared use.
- [ ] Each webhook source has a generated secret and a test delivery was accepted.
- [ ] The box's config repo has a remote of its own and the last push succeeded.
- [ ] Your teammates know the terminal is a shell on your computer.

Last walked through: not yet verified on a fresh host (product 0.3.0).
