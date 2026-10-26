---
title: "AWS"
description: "The compose file on one EC2 instance, with an Application Load Balancer as the door."
---

There is no AWS module. This guide puts the compose file from `deploy/compose` on one EC2
instance, with an Application Load Balancer as the door. It is written for people comfortable in
the AWS console or with their own Terraform or CDK.

## 1. What you get

- **Identity mode** `oidc` behind an ALB, or `proxy` behind Cloudflare Access. Pick one:
  - **ALB + the box's own OIDC sign-in.** The ALB terminates TLS and forwards to the box; the box
    signs people in with your identity provider (Cognito, Okta, Entra, Google). Simple and keeps
    every check inside the app.
  - **Cloudflare Access in front** (`proxy` mode). Cloudflare signs people in and sends their
    email with a shared secret; the ALB only accepts Cloudflare's addresses.
- **The box** is one EC2 instance in a private subnet running the workbench container from the
  compose file (without its oauth2-proxy service when you use the ALB route).
- **Webhooks** arrive on a second ALB listener or host rule pointing at the hooks door (port 8081),
  which accepts only `POST /hooks/...`.
- **Persistence** on an EBS volume mounted at the Docker volume path, with daily snapshots by Data
  Lifecycle Manager. Secrets live in the box's file store on that volume.

The ALB's own Cognito or OIDC authentication action is not used: it sends identity in headers
signed for the ALB, and the workbench does not verify ALB signatures. The box's own OIDC sign-in
does the same job with checks the app makes itself.

## 2. Security

What the door verifies. In `oidc` mode the box sends people to your identity provider, checks the
returned ID token's signature, issuer, audience and nonce, and keeps a signed session cookie. In
`proxy` mode behind Cloudflare Access the box believes the email header only with the shared secret
Cloudflare adds (`X-Workbench-Proxy-Secret`), compared against the secrets store.

What can reach the box. The instance sits in a private subnet. Its security group admits only the
ALB's security group, on 8080 (app) and 8081 (hooks). Outbound goes through a NAT gateway. Use SSM
Session Manager for admin access instead of SSH.

How secrets are stored. In `/data/internal/secrets.json` on the EBS volume, mode 600, owned by the box
user. EBS encryption with a KMS key covers them at rest. Values never go into config.json or git.

What people on the list can do. Everyone who signs in can open a shell on the box, with every token
on it. Use the viewer role for people who should only watch. The instance role should allow nothing
beyond what the box needs; it needs nothing at all for the compose setup.

What stays outside. The identity provider decides who can sign in to it. The box's own list in
Settings › People decides who gets in to the box and as what.

Threats, briefly:

- **The ALB is opened to the instance directly.** The app still requires its own session cookie
  (`oidc`) or the proxy secret (`proxy`). Keep the security groups tight anyway.
- **A hooks secret leaks.** Rotate it on the Secrets page and update the sender.
- **The EBS volume is lost.** Restore from a snapshot (section 6). The box's config repo's
  remote holds config and skills even without one.
- **The OIDC client secret leaks.** Rotate it at the provider and on the Secrets page.

## 3. Users

- **In `oidc` mode** add people or whole domains in Settings › People. With an empty list only the
  bootstrap admin (`WB_BOOTSTRAP_ADMIN`) can sign in, so an open provider never lets the world in.
- **In `proxy` mode with Cloudflare Access** the Access policy decides who reaches the box; the
  People list then decides roles, and once it has entries, it also limits who gets in.
- **Sign-ins last** `auth.oidc.sessionHours` (default 168 hours). Removing someone from the list
  locks them out on their next request, whatever their cookie says.
- **Terminal tokens** are revoked within seconds of someone being removed or made a viewer.
- **Read-only terminals** come with the viewer role.

## 4. Provision

1. **Network.** A VPC with public subnets for the ALB and a private subnet for the instance, plus a
   NAT gateway.
2. **Instance.** Amazon Linux 2023 or Ubuntu 24.04, `t3.xlarge` or larger, with Docker and the
   compose plugin. Attach a 100 GB gp3 volume, format it once, and mount it at
   `/var/lib/docker/volumes/workbench_workbench-data` before the first `docker compose up`, or
   change the compose file's volume to a bind mount of your EBS mount point.
3. **Compose.** Copy `deploy/compose` to the instance and create `.env` from `.env.example`.
   For the ALB route, remove the `oauth2-proxy` service, set `AUTH_MODE: oidc` on the workbench
   service, publish 8080 to the ALB, and seed the OIDC settings:

   ```yaml
   environment:
     AUTH_MODE: oidc
     WB_SEED_SETTINGS: '{"auth":{"oidc":{"issuer":"https://cognito-idp.<region>.amazonaws.com/<pool-id>","clientId":"<client-id>"}},"access":{"domains":["example.com"]}}'
     OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
   ports:
     - "8080:8080"
     - "8081:8081"
   ```

   Register `https://<app domain>/auth/callback` as the client's callback URL.
4. **ALB.** An HTTPS listener with an ACM certificate. Host rule for the app domain to a target
   group on port 8080 (health check `/api/health`, stickiness off, idle timeout 3600 seconds for
   websockets). Host rule for the hooks domain to a target group on port 8081 (health check on
   port 8080, path `/api/health`).
5. **Cloudflare Access instead** (`proxy` mode): put the app domain behind an Access application,
   add a request header rule that sends `X-Workbench-Proxy-Secret` with a value you generate on
   the box's Secrets page as `PROXY_SECRET`, set `auth.proxy.emailHeader` to
   `Cf-Access-Authenticated-User-Email`, and restrict the ALB's security group to Cloudflare's
   published ranges.
6. **Snapshots.** A Data Lifecycle Manager policy on the volume's tag, daily, keep 14.

## 5. First boot

Open the app domain. Sign in, then follow the Setup page: install and sign in Claude Code in a
terminal (with a key or seat permitted for shared use), generate a
webhook secret, send a test delivery, create a workflow, and give the box's config repo a remote.

## 6. Updating, backing up and restoring

**Update.** Take a DLM snapshot first; the compose driver cannot. Then on the instance, in the
compose folder, run `WB_MANAGEMENT_TOKEN=<token> node <release>/packages/cli/src/wb.ts update --to <version> --via compose`
(the unpacked release tarball and Node 22.18 or newer are all it needs). It drains the box, backs it
up, swaps the image and puts the old one back if the new one is not healthy. See
[updating.md](updating.md) for every step and for doing it by hand.

**Back up.** DLM snapshots daily, plus a manual snapshot before updates.

**Restore a lost volume.** Create a volume from the latest snapshot in the same availability zone,
stop the stack, attach and mount it where the old one was, and start the stack.

**Restore a lost account or region.** Copy snapshots to another region or account ahead of time
(DLM cross-region copy). Rebuild the network and instance there, attach a volume from the copied
snapshot, and start. Without a snapshot, start fresh and restore the box's config from its remote:
config, skills and scripts return; sign-ins, secrets and history do not.

## 7. Checklist

- [ ] The instance has no public address and only the ALB can reach ports 8080 and 8081.
- [ ] The hooks domain answers `GET /api/me` with 404.
- [ ] A private window on the app domain is sent to sign in.
- [ ] Settings › People lists your team or domain, and the first admin is set.
- [ ] Claude Code is signed in with a key or seat permitted for shared use.
- [ ] The Setup page shows the data volume as mounted.
- [ ] EBS encryption is on and a snapshot exists for today.
- [ ] Each webhook source has its own generated secret and a test delivery was accepted.
- [ ] The box's config repo has a remote of its own and the last push succeeded.
- [ ] Session Manager works and port 22 is closed.

Last walked through: not yet verified on a fresh host (product 0.3.0).
