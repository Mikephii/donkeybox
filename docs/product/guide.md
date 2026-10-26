---
title: "Using the workbench"
description: "How the box works, how to set it up, and a worked Jira example."
---

The workbench runs Claude Code agents on one box and gives a team one place to watch them, answer
their questions and decide what they may do alone. This guide covers getting a box going, how the
parts fit, and connecting a real system.

The fastest way to set things up is to ask an agent to do it for you (section 9). The rest shows
what it does, so you can check its work or do it by hand.

## 1. Start a box

On your own machine:

```sh
pnpm run setup   # once: Zellij, Caddy, dependencies, .env
pnpm start       # everything; Ctrl-C stops it
```

Open http://localhost:8080. To see what a second person sees, open `http://localhost:8080/?as=alice`
in a private window.

For a box your team shares, follow a hosting guide in the product's [`docs/hosting/`](https://github.com/mikephii/donkeybox/tree/main/docs/hosting) folder: Google
Cloud with IAP, AWS, any Linux host behind a sign-in proxy, Fly, your own computer, or behind an app
you already run.

Then open [Setup](/setup). It lists what the box still needs and checks each item itself: an admin,
the data volume, the webhook address, Claude Code's sign-in, secrets, a test delivery and a first
workflow.

## 2. Where things live

- **The product** is the code you cloned or the image you run. Updating it changes nothing else.
- **The workspace** is the box's own config: `config.json` (sources, workflows, rules, terminals,
  settings), skills in `.claude/skills`, and scripts in `bin`. It is a git repo, but it is the box's
  config repo, never your code. Every save from these pages is a commit with your name on it, and
  agents that edit it are told to commit too. Give it a remote of its own in
  [Settings](/settings?tab=workspace) and you can edit it from a laptop; the box pulls every five
  minutes. The pages are one way to edit it; a terminal, the editor or `claude` are others.
- **The data folder** is the workbench's own: the database of runs and requests, canvases, run
  folders, secrets and keys. Nothing in it needs you; leave it alone. On a hosted box it sits on its
  own volume with the box user's home, so replacing the machine loses nothing.
- **Your code** lives wherever you put it: clone repos into the home folder from a terminal, with
  your own credentials, and work on them however you like. The workbench does not manage them.

If someone breaks `config.json` by hand, the box keeps running on the last good version and shows
the errors at the top of every page until it is fixed.

## 3. How the pieces fit

```
Source ──event──▶ Rule ──prompt──▶ Run of a workflow ──request──▶ Inbox ──button──▶ back to the agent
```

- **[Sources](/sources)** are where events come from: a webhook from GitHub, Jira or CI, a generic
  event from your own scripts, or a schedule. Each webhook proves it is genuine before the box reads
  it, then becomes an event such as `jira.issue.created`.
- **Rules** say "when this event happens, run this prompt in this workflow". They live on each
  workflow's Rules tab.
- **[Workflows](/workflows)** are what you build. Each has a skill (the instructions the agent
  follows), an autonomy policy, buttons for its requests, allowed tools, MCP servers, guard patterns
  and, if you like, a folder its runs start in.
- **Autonomy** decides how much the agent asks first. Autonomous just does the job. Ask-first raises
  a request before changing anything. Guarded acts freely, but a tool call that matches a guard
  pattern waits until someone allows or denies it.
- **Requests** land in the [Inbox](/inbox) with the workflow's buttons. A button sends its prompt
  back to the agent, which carries on in the same conversation.
- **[Runs](/runs)** are agent sessions: what started each one, its timeline, its live terminal, what
  it changed and what it cost.
- **Canvases** are shared screens of windows: terminals, request queues, run lists, previews and the
  editor, arranged however your team likes.

## 4. People and roles

Admins change how the box works: settings, workflows, sources and secrets. Members run
things: they start and steer runs, answer requests, open terminals and arrange canvases. Viewers
watch everything and change nothing; their terminals are watch-only. Set roles in
[Settings › People](/settings?tab=access).

Everyone except a viewer can open a terminal, and a terminal is a shell on the box with every token
it holds. Give the member and admin roles only to people you would give a server login.

## 5. Secrets

Webhook secrets, MCP tokens and sign-in secrets are referenced by name, such as
`JIRA_HOOK_SECRET`, and stored on the box. [Secrets](/secrets) lists each name, whether it is set
and where it is used. **Generate** makes 32 random bytes and shows them once; paste them into the
sender straight away. **Rotate** replaces a value, and the old one stops working at once. A secret
in use cannot be deleted. A name that is not in the store falls back to an environment variable of
the same name, which is how `.env` keeps working on a laptop.

In an MCP server's settings, write `${secret:NAME}` where a token goes, or use the key button next to
the field to generate one or move a pasted token into the store.

## 6. Code and working folders

The workbench does not manage your code repos. Clone them in a terminal (into the home folder, say),
with whatever credentials you like, and work on them the way your team does. To have a workflow's
runs work on one, set its **Working folder** on the workflow's Settings tab. Runs then start there,
with the workflow's skills, and the skill says everything else: whether to make a branch or a
worktree, how to commit, whether to push. **More folders runs may use** lets runs touch other folders
too. Leave the working folder empty and each run gets a fresh folder of its own.

## 7. Terminals

Two terminals are always there: `shell`, a shell in the workspace, and `services`, with one tab per
service tailing its log. Open more from a Terminal window's picker, or from its window menu: give it a
name, a starting folder (the workspace or any folder) and a first command if you like. The
picker groups terminals as standing, yours, other people's, and runs, which stay folded away; a run's
own terminal is on its run page.

To work with Claude Code yourself, type `claude` in a terminal. A terminal survives closing its
window, so long jobs keep running.

## 8. MCP servers

Runs see only the MCP servers listed on their workflow. The simplest way to add one:

1. In a terminal on the box, add it and sign in as the box user:
   ```sh
   claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp/authv2
   claude          # then /mcp, choose atlassian, Authenticate
   ```
2. On the workflow's MCP servers tab, press **Import from Claude Code**, tick the server and save.

Runs reuse the box user's sign-in for a server with the same name and URL; this was checked with a
real OAuth sign-in and a run calling the server's tool. Tokens found in imported servers move into
the secrets store, and the workflow keeps only `${secret:NAME}`.

## 9. The quickest path: ask the agent

Open the Work canvas, click into the `shell` terminal (it starts in the workspace) and run `claude`.
The workspace's `.mcp.json` gives it the workbench's admin tools: `setup_reference`,
`list_workflows`, `upsert_workflow`, `write_skill`, `upsert_rule`, `upsert_source`, `test_source`,
`list_secrets`, `new_terminal`, `upsert_window` and more. They go
through the same checks as the pages, so a bad change is refused with the reason. Then ask, for
example:

> Connect our Jira. New issues in the SHOP project should be triaged automatically. Anything that
> deletes or moves an issue needs a person to approve. Add a Jira source, a workflow with a skill for
> this, guard the destructive Jira tools, and put a Requests window for it on the Work canvas.
> Read setup_reference first, and test the source when you are done.

Only this human session gets admin tools. Runs started by rules never do, so an agent reacting to
a webhook cannot rewrite its own setup. The admin tools can list secrets but not read or set them;
you create those on the Secrets page.

## 10. Worked example: connect real Jira

This is what section 9 does, by hand. Nothing touches Jira until step 1.

1. **Give the box access to Jira.** In a terminal:
   ```sh
   claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp/authv2
   claude          # then /mcp, choose atlassian, Authenticate
   ```
2. **Create the workflow.** [New workflow](/workflows/new): name it "Jira triage", autonomy
   guarded, buttons Approve, Needs changes and Reject, with a starter skill.
3. **Import the MCP server.** On its MCP servers tab press Import from Claude Code, tick `atlassian`
   and save.
4. **Allow and guard its tools.** On Guards & tools, allow `mcp__atlassian__*`. Then add guard
   patterns for the tools that edit, move or delete issues. `/mcp` in Claude Code lists their names.
5. **Write the skill.** On the Skill tab, say what triage means for your team: which fields to read,
   how to label, when to raise a request, and what each button means.
6. **Add the source.** [Sources](/sources) › New source: ID `jira`, kind Webhook from a service,
   path `/hooks/jira`, mapping Jira adapter, and "How the sender proves it is genuine" set to Secret
   in the URL. Jira Cloud's webhooks cannot sign bodies or add headers, so the secret travels as the
   last part of the URL. Type `JIRA_HOOK_SECRET` and press **Generate**: the full URL, token
   included, is shown once. Lost it? Rotate the secret on [Secrets](/secrets) and paste the new URL.
7. **Point Jira at it.** In Jira, open System › WebHooks › Create a WebHook, paste the URL and choose
   "Issue created". Jira cannot reach `localhost`, so on a laptop use **Send a test delivery**
   instead; it builds the URL with the token exactly as Jira would.
8. **Start the workflow from the event.** On the workflow's Rules tab add a rule: when
   `jira.issue.created`, prompt `/jira-triage {{payload.key}}`. A filter such as `project = SHOP`
   limits it to one project.
9. **Add a view.** On a canvas, unlock it, choose Add window › Requests, filter it to Jira triage,
   name it, and lock the canvas again.

Then send a test delivery with "also run matching rules" ticked and watch the run appear in
[Runs](/runs).

## 11. Try it without touching anything real

The example workflows use stand-ins: `jira` and `mail` in the workspace's `bin` folder write to
files in the data folder and never contact a real system. **Email Jeff** drafts an email, asks you
to Send, Change it or Discard it, and "sends" by writing to `fake-mail.json`. Start a run from
[Runs](/runs) › Start run in the Email Jeff workflow with `/email-jeff ask him for the Q3 numbers`,
and read the outbox with `mail outbox` in a terminal.

## 12. The editor

Turn on code-server in [Settings](/settings) › General › Editor after installing it once with
`wb tools install code-server` in a terminal. A **Code** window then opens the box's config and your
home folder in a browser VS Code; switch it to the whole box, or use File › Open Folder to go
anywhere. The Skill tab gets an "open in editor" link. Its built-in terminal is fine for quick
commands. For anything that should outlive the browser tab, use a Terminal window, or run
`zellij attach` inside it.

A **Document** window shows a markdown file on the box, rendered, and keeps it up to date as the file
changes. Run `wb open plan.md` in a terminal and it opens beside that terminal; a skill can do the
same, so a proposal or a report reads as a page instead of terminal text. Documents are `.md` files
in the workspace, the home folder or `/tmp`.

## 13. When the box sleeps, restarts or updates

A hosted box may be stopped while nobody uses it, or replaced on an update. Terminals come back
fresh and a banner says so. Runs that were working are marked interrupted, and their run page has a
**Resume** button that carries on in the same Claude Code session and folder. Nothing on the data
volume is lost.

**Updates.** Whoever hosts the box updates it with `wb update` or their own control plane (see
`docs/hosting/updating.md`). First the box drains: a blue banner says an update is coming, new runs
wait in the queue, and runs already going carry on until they finish or the drain times out. Then it
takes a backup in its internal folder and restarts on the new version. If the new version does not
come up, the old one goes back on and restores that backup when it needs to. On a box you run
yourself, `wb admin drain` and `wb admin backup` in a terminal do the first two steps by hand, and
`wb admin undrain` ends a drain without updating.

An update changes only the workbench. Claude Code, programs in the tools folder and anything else
installed in the box are yours to keep current; the workbench never updates or checks them.

## 14. Canvas tips

- Canvases are locked by default, so windows cannot be moved or closed by accident. Terminals,
  buttons and forms still work. Click **Locked** to unlock; the button shows who unlocked it.
- Hold Space and drag to pan, or drag with the middle mouse button. Scrolling pans; Cmd or Ctrl with
  scroll, or a pinch, zooms. The controls in the bottom right zoom, reset to 100% and fit all windows.
- **Arrange** tidies windows into rows or tiles them to the screen. Cmd or Ctrl+Z undoes your own
  layout changes. Closed windows come back from Add window › Recently closed.
