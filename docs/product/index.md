---
title: "Getting started"
description: "Run a box on your own machine, then try the demo workflows."
---

## Run it on your machine

You need macOS or Linux, Node 22.18 or newer, pnpm, and Claude Code signed in.

```sh
git clone https://github.com/mikephii/donkeybox.git
cd donkeybox
pnpm run setup   # once: Zellij and Caddy into .tools/bin, dependencies, Playwright, .env
pnpm start       # everything; Ctrl-C stops it
```

Open http://localhost:8080. The first start creates `workspace/` from `workspace-template/`: the
box's own config repo (config, skills, scripts), never your code. The workbench commits every save
there. Open `http://localhost:8080/?as=alice` in a private window to see a second person.

Then open **Setup** and the **Guide** in the app's sidebar. The Guide is the same text as
[Using the workbench](guide.md).

## Stopping it

Press Ctrl-C in the terminal running `pnpm start`. The box's standing terminal sessions keep
running on purpose, so terminals survive restarts. To stop those too:

```sh
ZELLIJ_SOCKET_DIR=$(ls -d /tmp/wb-zj-* | head -1) .tools/bin/zellij kill-all-sessions -y
```

## Things to try

Each starts a real Claude Code run on Haiku and costs a few cents. The demo's `jira` and `mail`
are stand-ins that write to files in `data/`; nothing real is contacted.

- **A webhook run.** `scripts/fake-webhook.sh 412 "Fix checkout rounding"` sends a signed GitHub
  "PR merged" webhook. A run appears in Runs, writes a changelog line and stops.
- **Email Jeff.** Start a run in the Email Jeff workflow with `/email-jeff ask him for the Q3 numbers`.
  Press `1` in the Inbox to send. Read the outbox with `mail outbox` in a terminal.
- **A guarded tool call.** Start a run in Jira tickets with
  `/jira-tickets delete DEMO-2, it is a duplicate of DEMO-1`. The delete waits for Allow or Deny.
- **An agent that waits.** Start a run in Scoping with
  `/scoping Add a wishlist so customers can save products for later`, then press Needs changes.
- **Ask an agent to set things up.** Type `claude` in the `shell` terminal. It has the workbench's
  admin tools and can build workflows, sources and windows for you.

## Next

When it works on your machine, pick a [hosting guide](../hosting/index.md) to run it for a team.
Claude Code on a shared box must be signed in with a key or seat your plan permits to be used by
several people.
