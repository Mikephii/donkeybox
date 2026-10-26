---
title: "The wb command"
description: "wb is the workbench CLI, used by agents, hooks, people in terminals and update scripts."
---

`wb` talks to the box's loopback API. Inside a box it is on every terminal's and every run's PATH.
`wb help` prints the same list.

## Runs and requests

| Command | What it does |
|---|---|
| `wb request --title T [--body B \| --body-file F] [--group G] [--action id:Label]... [--wait]` | Raise a request in the Inbox. Deferred by default; `--wait` blocks until a person answers. |
| `wb note "text"` | Post a note to the current run's timeline. |
| `wb open FILE.md [--title T]` | Show a markdown file as a Document window beside this terminal, rendered and kept up to date. For people's terminals; refused inside runs. |
| `wb requests [--status S] [--group G]` | List requests. |
| `wb approved [--group G]` | Answered requests whose chosen action was approve or allow. |
| `wb emit TYPE [--summary S] [--payload JSON]` | Emit an event that rules can start runs from. |
| `wb run --group G --prompt P [--title T] [--goal CMD] [--print]` | Start a run in a workflow. |
| `wb runs [--live]` | List runs. |

## The box

| Command | What it does |
|---|---|
| `wb svc` | Interactive service menu; `wb svc status`, `wb svc logs ID`, `wb svc restart ID`. |
| `wb sessions ensure \| cleanup [--hours N]` | Standing terminal sessions. |
| `wb tokens reconcile` | Reissue terminal tokens to match the People list. |
| `wb secrets` | Secret names, where each is used, and whether it is set. |
| `wb secrets set NAME` | Store a value read from stdin, so it stays out of shell history. |
| `wb secrets generate NAME` | Store 32 random bytes and print them once. |
| `wb secrets rotate NAME [--generate]` / `wb secrets delete NAME` | Rotate, or delete one no longer referred to. |
| `wb tools list` / `wb tools install NAME` | Pinned programs (code-server, claude-code, zellij, caddy) in the box's tools folder. |
| `wb migrate-workspace [--from DIR] [--to DIR]` | One-off: move an old `workflows/` folder into a workspace repo. |

## Admin tools

`wb admin` is for a person's own `claude` session in the workspace, and is refused inside runs:
`workflows`, `skills`, `rules`, `sources`, `terminals`, `canvases`, `windows`, `drain` and
`undrain`, `backup` and `backups`. Each takes `get`, `put` and `delete` forms; `wb help` lists them.

## Releases and updates

| Command | What it does |
|---|---|
| `wb manifest IMAGE` | Print the release manifest an image carries in its `org.donkeybox.release` label, read from the local Docker engine or the image's registry. |
| `wb update --to VERSION --via compose\|gcp\|fly [--image REF] [--timeout SECONDS] [--dry-run]` | Update a hosted box through its management API. See [Updating a box](../hosting/updating.md). |
