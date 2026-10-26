<p align="center">
  <img src="brand/logo.svg" alt="DonkeyBox logo" width="120">
</p>

<h1 align="center">DonkeyBox</h1>

<p align="center">A shared box for running Claude Code agents as a team.</p>

DonkeyBox (the workbench) is a web app that runs coding agents on one machine and gives a team one
place to watch them, answer their questions and decide what they may do alone. Agents are Claude Code
sessions in hidden terminals. They raise requests when they need a person and act alone when policy
allows. People work in management pages (Inbox, Runs, Workflows, Sources, Secrets, Settings) and on
canvases: shared pan-and-zoom screens of windows such as terminals, request queues, run lists,
previews and an editor.

## Demo



https://github.com/user-attachments/assets/514db5e6-445c-41bb-a92f-b195873b495a



The clips are recorded from a real box running the real image, with a scripted stand-in for the model
(`demo/model/`) so every take comes out the same. [demo/README.md](demo/README.md) shows how to
record them again.

## What it does

- **Workflows and runs.** A workflow is a skill (the agent's instructions), an autonomy policy,
  allowed tools, MCP servers and the buttons for its requests. Each run is an agent session with a
  timeline, a live terminal, what it changed and what it cost.
- **An Inbox for people.** When an agent needs a decision it raises a request with the workflow's
  buttons. A button sends its prompt back, and the agent carries on in the same conversation.
- **Autonomy you choose.** Autonomous just does the job, ask-first raises a request before changing
  anything, and guarded acts freely but holds any tool call that matches a guard pattern until
  someone allows or denies it.
- **Sources and rules.** Signed webhooks from GitHub, Jira or CI, generic events and schedules start
  runs: "when this event happens, run this prompt in this workflow".
- **Shared canvases.** Terminals, request queues, run lists, previews, markdown documents and a
  code editor, arranged however the team likes and seen live by everyone on the box.
- **People, roles and secrets.** Admins, members and watch-only viewers. Secrets are referenced by
  name and never read back once stored.
- **Set it up by asking.** Type `claude` in the box's `shell` terminal: it has the workbench's admin
  tools (the `wb` CLI and an MCP server) and can build workflows, sources and windows for you.

## Run it on your machine

You need macOS or Linux, Node 22.18 or newer, pnpm, and Claude Code signed in.

```sh
git clone https://github.com/mikephii/donkeybox.git
cd donkeybox
pnpm run setup   # once: Zellij and Caddy into .tools/bin, dependencies, Playwright, .env
pnpm start       # everything; Ctrl-C stops it
```

Open http://localhost:8080. The first start creates `workspace/` from `workspace-template/`: the box's
own config repo (config, skills, scripts), never your code. The workbench commits every save there.
Open `http://localhost:8080/?as=alice` in a private window to see a second person.

New here? Open **Setup** and the **Guide** in the app's sidebar. The rest of the documentation is in
[docs/](docs/README.md).

## Self-hosting

To run a box for a team, start with [docs/hosting/index.md](docs/hosting/index.md). It has the one
rule every method follows: people reach the app only through a door that proves who they are, and
everyone that door lets in can open a shell on the box, so treat that list like a list of server
admins. Then pick a guide:

| Guide | Door |
|---|---|
| [Google Cloud with IAP](docs/hosting/gcp-iap.md) | the Terraform module in `deploy/gcp` |
| [AWS](docs/hosting/aws.md) | an ALB with the box's own OIDC sign-in, or Cloudflare Access |
| [Any Linux host](docs/hosting/self-hosted-proxy.md) | `deploy/compose` with oauth2-proxy, or Cloudflare Access, Pomerium, Tailscale |
| [Fly](docs/hosting/fly.md) | one Fly Machine with a volume |
| [Your own computer](docs/hosting/own-computer.md) | Tailscale Serve or Cloudflare Access |
| [Behind your own app](docs/hosting/behind-your-own-app.md) | your product's login |

Every method runs the same image (`Dockerfile`), with all state on one `/data` volume. Images are
published to `ghcr.io/mikephii/donkeybox` from tagged releases; to build your own, see
[Build the image yourself](docs/hosting/index.md#build-the-image-yourself). To update a box, read
[docs/hosting/updating.md](docs/hosting/updating.md): `wb update` drains it, backs it up, swaps the
image and puts the old one back if the new one fails.

Claude Code on a shared box must be signed in with an API key or a seat your plan permits to be used
by several people.

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

## Where things live

| Path | What |
|---|---|
| `packages/app` | The app, engine, supervisor, webhook listener, Yjs server and web UI |
| `packages/cli` | `wb`, used by agents, hooks and people in terminals (`wb tools install`, `wb secrets`, `wb admin`) |
| `packages/mcp` | The workbench MCP server: request tools for runs, setup tools for a person's own Claude Code session |
| `packages/hooks` | Claude Code hook and status line scripts |
| `workspace-template/` | What a new box's workspace starts as, with a working demo |
| `workspace/` | The box's config repo (created on first start). Not your code; your repos can live anywhere |
| `data/` | The workbench's internal folder: database, canvases, run folders, secrets, keys, logs. Leave it alone; delete it to start fresh. |
| `deploy/` | Image entrypoint, GCP module, compose file, Fly example |
| `docs/` | The documentation: [product/](docs/product/index.md), [hosting/](docs/hosting/index.md) (one guide per way of hosting) and the [design log](docs/decisions.md) |
| `apps/docs/` | The docs site, built from `docs/` (Fumadocs on React Router); `pnpm docs:dev` previews it locally. Its own lockfile; not in the image |
| `demo/` | The rig that records the demo clips from a real box |
| `schema/config.schema.json` | JSON schema for the workspace's `config.json` |
| `versions.json` | Pinned versions of Node, Zellij and Caddy (part of the image), and the code-server and Claude Code versions `wb tools install` puts in a box the first time. Updates never touch what is installed in a box. |
| `dist/` | Releases from `pnpm release`: the tarball and its manifest (`workbench-<version>.release.json`). `pnpm release --push` also pushes the multi-arch image, with the manifest as its `org.donkeybox.release` label; a `v<version>` tag does it in CI |

## Contributing

Pull requests are welcome: bug fixes, docs, hosting guides and features. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first, and open an issue before starting anything large. Please
follow the [code of conduct](CODE_OF_CONDUCT.md), and report security problems as
[SECURITY.md](SECURITY.md) says, not in an issue. Every default chosen while building is in
[docs/decisions.md](docs/decisions.md), with the reason.

## Tests

```sh
pnpm test        # vitest
pnpm test:e2e    # Playwright against the running box (pnpm start first); leaves no trace
pnpm typecheck
pnpm docs:build  # the docs site; CI runs all of these on every pull request
```

The upgrade tests run the code of every earlier release that may upgrade straight to this one,
from the tarballs in `dist/`; CI downloads them from the GitHub releases.

## Licence

The code is [MIT](LICENSE). The documentation in `docs/` is [CC BY 4.0](docs/LICENSE). The name and
logo are covered by [TRADEMARKS.md](TRADEMARKS.md), and the programs DonkeyBox runs are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
