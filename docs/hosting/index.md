---
title: "Hosting guides"
description: "Pick a way to host a box. Each guide stands on its own and ends with a checklist."
---

The workbench is one box: a VM, a container or a laptop running the app, its terminals and its
agents. Pick a guide below. Each one stands on its own and ends with a checklist.

## The one rule

People reach the app only through a door that proves who they are and hands the app a verified
identity. The app is never on the open internet by itself. The webhook listener is the only part
that is, on its own address, and it accepts nothing but signed `POST /hooks/...` requests.

Everyone the door lets in can open a shell on the box. That shell holds every token the box has:
the box's deploy key, your MCP sign-ins, the box's Claude Code sign-in and the secrets store.
Treat the list of people like a list of server admins, and use the viewer role for anyone who
should only watch.

The app checks the door's work instead of trusting it blindly:

| Mode | Door | What the app checks |
|---|---|---|
| `iap` | Google Cloud IAP | IAP's signed JWT, its issuer and the box's own audience |
| `proxy` | oauth2-proxy, Cloudflare Access, Pomerium, Tailscale, your own backend | a shared secret header from the secrets store, or the request coming from the proxy's network |
| `oidc` | the box's own sign-in page | the identity provider's signed ID token, then a signed session cookie |
| `dev` | none | nothing. It refuses to start with `NODE_ENV=production` |

`AUTH_MODE` is an environment variable of the box, never a setting, so an edit to the workspace
cannot turn sign-in off.

## The guides

| Guide | Door | Good for |
|---|---|---|
| [gcp-iap.md](gcp-iap.md) | IAP on a Google load balancer | teams on Google Workspace who want the Terraform module |
| [aws.md](aws.md) | an ALB with Cognito or OIDC, or Cloudflare Access | teams on AWS |
| [self-hosted-proxy.md](self-hosted-proxy.md) | oauth2-proxy, Cloudflare Access, Pomerium or Tailscale | any Linux host with Docker |
| [fly.md](fly.md) | the box's own OIDC sign-in | one Fly Machine with a volume |
| [own-computer.md](own-computer.md) | Tailscale Serve or Cloudflare Access | a laptop or desk machine shared with a few people |
| [behind-your-own-app.md](behind-your-own-app.md) | your product's login | putting the workbench inside something you already run |

Updating works the same way everywhere: [updating.md](updating.md) covers `wb update`, the rules that
keep a rollback to the previous image cheap, and the contract a control plane follows.

## The image

Every guide runs the same image. Tagged releases are published to `ghcr.io/<owner>/donkeybox`, where
`<owner>` is the GitHub account the repository lives under, as `<version>` and `latest`. Pin a
version, never `latest`, so an update is always a deliberate swap.

### Build the image yourself

To run a fork, a change of your own or a release that isn't published yet, build the image from a
checkout:

```sh
pnpm install
pnpm release                                   # local image for this machine; nothing pushed
IMAGE=registry.example.com/you/donkeybox pnpm release --push   # multi-arch, pushed to your registry
```

`pnpm release` builds the image tagged with `package.json`'s version, writes the release manifest and
a source tarball into `dist/`, and checks that the image's `org.donkeybox.release` label matches the
manifest. `wb update` reads that label, so build with `pnpm release` rather than a bare `docker build`
for any box you mean to update later. `IMAGE` defaults to `ghcr.io/mikephii/donkeybox`;
pushing needs `docker login` to the registry first.

Then point the guide at your image: `WORKBENCH_IMAGE` in the compose `.env`
([self-hosted-proxy.md](self-hosted-proxy.md), [aws.md](aws.md)), `image` in the Terraform module
([gcp-iap.md](gcp-iap.md)), `image` in `fly.toml` ([fly.md](fly.md)), or the image name in the
`docker run` line of [behind-your-own-app.md](behind-your-own-app.md). A VM or a Fly Machine has to be able to pull it, so push it to a
registry it can reach (Artifact Registry in the same project on Google Cloud, ECR on AWS); a box on
your own computer can use the local image as it is.

## Before any of them: Claude Code's sign-in

The box signs in to Claude Code once, as its own user, and every run and every terminal on the box
uses that sign-in. Use an API key or a seat your plan permits to be used this way by several people.
A personal subscription is for one person; check your plan's terms before sharing a box on it.

## What every box keeps on its data volume

The workspace (the box's own config repo: config, skills, scripts; never your code), the
workbench's internal folder (database of runs, requests and activity, canvases, run folders, the
secrets store, the deploy key), the box user's home (Claude Code sign-in, MCP sign-ins, Zellij
tokens, and any code you clone there) and tools installed with `wb tools install`. Back that volume
up and nothing else matters: replacing the machine or the image loses nothing.

Give the box's config repo a remote of its own (Settings › Box config repo) and every save is
pushed there too, so your config survives even a lost volume. Your code repos are yours: the
workbench never commits to them, pushes them or manages their branches.
