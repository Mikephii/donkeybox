# Decisions

The design log kept while DonkeyBox was built. Each numbered entry is a default that was chosen, or
a place where the build differs from the original design, with the reason; the numbered entries run
oldest first. Findings about Zellij are at the top because they are the ones most likely to matter
on upgrade. When you choose something a reader would otherwise wonder about, add an entry at the
end. The log is for GitHub readers and is not part of the docs site.

## Zellij

1. **Release binaries in `.tools/bin`, not Homebrew.** On this macOS version Homebrew had no
   bottles and started compiling CMake from source. `scripts/setup.sh` downloads the official
   Zellij 0.45.1 and Caddy 2.11.7 releases instead, on both macOS and Linux.
2. **Short socket directory, one per data folder.** macOS caps Unix socket paths at 103 bytes, and
   the default temp dir plus a run session name went over. Every Zellij process the workbench starts
   uses `ZELLIJ_SOCKET_DIR=/tmp/wb-zj-<hash of the data folder>` (round 3; it was
   `/tmp/wb-zellij-<uid>`), which also keeps workbench sessions out of your personal `zellij ls`.
3. **`base_url` does not move Zellij's routes.** The server always serves at its root; `base_url`
   only feeds the share plugin's links. Caddy strips `/term` with `handle_path`, and the web
   client works out `/term` from its own script URL.
4. **Framing.** Zellij sends `X-Frame-Options: DENY`. Caddy rewrites it to `SAMEORIGIN` on the
   `/term` route so terminals load in iframes on the same origin.
5. **Named tokens.** In 0.45.1 `--create-token` is exclusive, so `--token-name` cannot be used with
   it. The app creates a token, then renames it to the user's email with the same SQL statement
   Zellij's own `rename_token` runs, against Zellij's `tokens.db`. The plaintext token is kept in
   the workbench database per email, so logging in a second browser does not revoke the first.
   Pin the Zellij version and retest the login route on upgrade.
6. **Login route is `POST /api/term-login`**, not `GET /app/term-login` as the doc sketched. It
   reuses a valid Zellij cookie and only mints a session when needed.
7. **Standing sessions use `--default-layout` at creation.** `attach -b` ignores `--layout`, and
   tabs added to a detached session with `action new-tab` vanish when the first client attaches
   (0.45.1). `zellij attach -b NAME options --default-layout FILE` is reliable. Layouts are
   generated from `config.json` at app start and written to `data/zellij-layouts/` for reference.
8. **Steering uses `write-chars` with an explicit pane id** (`terminal_0`), then a separate Enter.
   Without the pane id the keystrokes can land in a plugin pane. Verified against a live Claude
   Code session, including while it was idle.
9. **Per-user theme in terminals.** Zellij seeds the terminal palette from the server config, so it
   cannot differ per user. The page reaches into the same-origin iframe and sets
   `window.term.options.theme` from the viewer's cookie. Zellij's default theme draws its bars from
   that palette, so they follow too. Programs that print true-colour (Claude Code's own UI) keep
   their colours.
10. **Focus stealing.** The Zellij client focuses itself when it loads. The canvas hands focus back
    unless the pointer is over that terminal, so a terminal loading elsewhere never takes your
    keystrokes and "typing" presence is only shown for real.

## Agent runs

11. **Interactive by default, in `run-<id>-<slug>` sessions**, with `--permission-mode dontAsk` so
    anything outside the allow list is refused instead of prompting. The allow list is a small
    base set (read, write, edit, the workbench MCP tools, `wb`) plus the group's `allowedTools`.
12. **Session ids are assigned up front** with `--session-id`. A deferred answer stops the origin
    session and starts a new run with `--resume <id>` in the same working folder, because Claude
    Code stores sessions per folder.
13. **Inherited environment is scrubbed.** Starting runs from inside a Claude Code session passed
    variables like `CLAUDECODE` and `CLAUDE_CODE_SESSION_ID`, which turned off transcripts.
    `run.sh` unsets them.
14. **Skills are linked into each run folder** under `.claude/skills`, one link per skill (round 3),
    so `/housekeeping` and friends are ordinary project skills and a repo's own skill of the same
    name wins. For worktree runs the links are added to the clone's `.git/info/exclude`.
15. **Cost comes from a status line command.** Interactive runs report `cost.total_cost_usd` through
    the status line script; print runs read it from the final result message.
16. **Guards fail closed.** If the hook cannot reach the app for 60 seconds, the tool call is denied.
    Guard patterns use Claude Code permission-rule syntax, e.g. `Bash(jira delete*)`.
17. **Goal checks** are shell commands run in the run's folder with a 30 second timeout, capped at 6
    retries (`WB_GOAL_MAX_ITERATIONS`).
18. **Demo groups use Haiku** to keep demo runs to a few cents each.
19. **Print-mode results are stored when the process exits**, even if hooks already marked the run
    done.

## App and data

20. **Native TypeScript in Node** (type stripping, Node 22.18+) for the backend, CLI, MCP server and
    hooks. No build step on the server side; only the frontend is built.
21. **One writer.** Only the app opens the database for writing. The webhook listener normalises
    and posts to the loopback API; agents and hooks use the loopback API too.
22. **Yjs carries layout and presence, not data.** The server bumps a counter per data kind and
    browsers refetch over REST, with a 15 second poll as a fallback. Yjs state is persisted to
    files in `data/yjs/`.
23. **y-websocket 2.1.0.** `@y/websocket-server` pulls in a Yjs 14 prerelease, which would load two
    Yjs copies. The 2.x package ships server utilities on Yjs 13; the Yjs server loads Yjs through
    `require` so there is one instance.
24. **Side pane state lives in the URL** (`?pane=run:42`), canvases in the path (`/c/:id`). That
    keeps the pane per person, linkable, and React Router only.
25. **Theme is a `wb-theme` cookie** (light, dark, system), never localStorage. The production
    server writes the class into the HTML before sending it; an inline script covers Vite in dev.
    `next-themes`, which shadcn's toaster pulls in and which uses localStorage, was removed.
26. **Dev identity.** `?as=alice` sets the identity for that tab (kept in sessionStorage), sent as
    `x-wb-as` and, for iframes and sockets, as a `wb-dev-as` cookie. Dev auth refuses to start with
    `NODE_ENV=production`.
27. **Notify means an in-app toast** for people on a group's `notify` list. No email or chat.
28. **One supervisor everywhere** (`packages/app/src/supervisor.ts`, round 3): it starts the core
    services and the workspace's `run` services, restarts them, and serves the list, restart and logs
    operations the Services page uses, on a laptop and in the container alike. The systemd units and
    `scripts/supervisor.ts` are gone.
29. **Previews can never reach the box's own ports**: the loopback API, management API, supervisor,
    app, webhook listener, Yjs, Zellij and code-server all answer 403 at `/p/<port>`.
30. **Session retention is 72 hours**, cleaned hourly. Cleanup also marks idle runs done.
31. **`pnpm start` starts everything.** `pnpm up` would have been nicer, but pnpm reserves it as an
    alias for `update`.
32. **Fastify force-closes connections on shutdown**, so long-polls do not hold a restart for the
    full timeout.

## Deploy

33. **Superseded in round 3.** The first design's Cloud Run doors and copied Terraform stack were
    replaced by the `deploy/gcp` module (entries 132 to 136).
34. **Infra changes sit on branch `agent-workbench`** in the infra repo, cut from `origin/main`,
    with no upstream set, uncommitted and unapplied. In round 3 its `environments/agents` became a
    module instantiation (entry 146).
35. **Superseded in round 3.** The webhook listener stays on 127.0.0.1; Caddy's separate hooks door
    (port 8081 in hosted setups) is the only way in from outside, and it accepts only `POST /hooks/...`.
36. **One-time steps are on the Setup page** (round 3): install and sign in Claude Code from a
    terminal, add the deploy key to repos, set secrets. Run folders no longer need a manual trust step
    (entry 90).
## Pages, canvas controls and setup tools

37. **Pages own the management work; canvases hold working views.** A sidebar leads to Inbox, Runs,
    Workflows, Sources, Services, Activity and Guide. Every page's selection and filters live in the
    URL (`replace` history, so filters do not flood the back button). Canvases moved to `/c/:id`.
38. **The side pane stays as a quick peek** from canvas windows, with "Open full page". Starting a
    run from a page goes to its run page instead.
39. **Pan and zoom are a CSS transform, not scrolling.** No scrollbars. Each person's pan and zoom
    per canvas is their own, kept in sessionStorage as a convenience. Zoom is 20% to 200%. Scrolling
    over a window's body scrolls that window; over the background or a title bar it pans.
    Cmd/Ctrl+scroll and trackpad pinch zoom around the pointer. Space-to-pan is ignored while typing
    in a field or inside a terminal, which keeps its own keys.
40. **The edit lock is a shared field on the canvas.** A canvas without the field counts as locked.
    A new canvas starts unlocked by whoever made it, because creating it is the start of an edit.
    Locked blocks move, resize, close, add, arrange, deleting the canvas and Cmd+Z. Windows stay
    usable, and renaming or describing a window is allowed. Admin tools may add windows to a locked
    canvas, since they act for the person who asked.
41. **Fixed: snapped positions could be overwritten** by a late throttled write from the drag.
    Drop and resize-end now cancel the pending write.
42. **The Config window is gone.** Old ones still on a canvas show a pointer to Workflows and Sources.
43. **Workflows page.** Forms cover every field of a group; rules are edited on the workflow they
    start; a JSON tab is the escape hatch. Deleting is refused while rules start the workflow.
    Deleting closes that workflow's open requests (nothing can answer them any more) and, if ticked,
    deletes its skill when no other workflow uses it. Renaming a workflow's id is not supported;
    create a new one.
44. **Skill writes are confined.** Names match `^[a-z0-9][a-z0-9-]{0,62}$`; the resolved path must
    stay inside the workspace's skills folder (`settings.skillsDir`, default `.claude/skills`);
    symlinked skill folders or files are refused; frontmatter must have a `name` equal to the folder
    and a `description`; 200 KB cap; atomic writes. A new workflow's starter skill goes into the same
    commit as the workflow, and is removed again if the config write fails.
45. **Validation messages carry field paths** (`group.actions.0.id: …`, `rules.1.on: …`,
    `source.verify.secret: …`) so forms show each error under its field.
46. **Stricter schema.** Rule `id`, `on` and `prompt`, workflow `title` and button `label` must be
    non-empty; button ids get a readable error.
47. **Test deliveries do not run rules by default.** The test is signed exactly like a real sender
    and goes through the listener, but carries `x-wb-test: 1`, so the event is recorded as "[test]"
    and no rule fires. A checkbox sends it as a real delivery. The listener records every delivery,
    including rejected and unknown-path ones, through the loopback API. Webhook URLs come from
    `settings.publicHooksUrl` (round 3, entry 68).
48. **Setup tools are for a person's own Claude Code session only.** The workspace's `.mcp.json`
    starts the workbench MCP server with `WB_ADMIN=1`, and its `.claude/settings.json` pre-enables
    it, so `claude` started in the workspace (the `shell` terminal) has them. Admin routes on the
    loopback API need the token in `data/admin.token` (mode 600). The MCP server and `wb` refuse admin
    work whenever `WB_RUN_ID` is set; runs use `--strict-mcp-config` so they never load `.mcp.json`;
    and runs' settings deny reading the token file.
49. **Inbox.** Open requests are grouped by workflow, newest first. Number keys press buttons in
    order; Cmd/Ctrl+Enter submits a button's form; Esc cancels and clears it. After answering, the
    cursor stays at the same position so triage flows down the list.
50. **Presence on pages.** Each person reports what they are looking at as subjects
    (`canvas:work`, `run:42`, `request:7`, `workflow:x`, `page:/sources`); a run open in a canvas
    side pane counts as being on that run.
51. **Email Jeff stays in the demo config**, as built by the `claude` session. Two lessons from
    building it are in its skill: write SUBJECT.txt and BODY.md at send time rather than trusting
    files from an earlier turn, and avoid `$(...)` in commands, because command substitution does
    not match a `Bash(mail:*)` allow rule. The fake `mail` accepts `--subject-file` for that reason.
52. **Paging.** Runs show 50 per page with totals for the whole filtered set; Activity shows 100 with
    "Load older".
53. **The Guide is a markdown file** (`web/src/pages/guide.md`) rendered in the app, with internal
    links turned into in-app navigation. Round 3 rewrote it around the workspace, roles, secrets,
    repos, terminals, MCP import, the editor and sleep. The Atlassian MCP command comes from
    Atlassian's docs as of October 2026.
54. **End-to-end tests use the live stack but leave no trace**: they work on throwaway canvases,
    restore the workspace's `config.json` and remove skills they created (committing the restore so
    the workspace is clean), close their requests, delete what they add, and never start agent runs.
## Round 3: PLAN.md (product, workspace and data split; hosting)

55. **Order of work.** Items 1 to 8 in order; then item 14 (one image, supervisor in the container,
    migrations, sleep and wake, management API, limits), because items 9 and 11 deploy that image and
    item 5 already needed migrations; then 10 and 15 (identity and roles, which the deploy doors
    depend on); then 9 and 11 together (the GCP module is where the data disk lives); then 11a, 12
    and 13. Items 1 and 14 both reshaped the repo, so the systemd units were retired directly.
56. **Three locations.** The product (this repo) is code only. The workspace (`WB_WORKSPACE_DIR`,
    default `./workspace`) is the team's git repo: `config.json`, skills, scripts, `CLAUDE.md`,
    `.mcp.json`. Data (`WB_DATA_DIR`, default `./data`) is SQLite, Yjs state, run folders, repo
    clones, keys, secrets and logs. The first start creates the workspace from
    `workspace-template/` and commits it. `pnpm migrate-workspace` moves an old `workflows/`
    folder into a new workspace.
57. **Every save is a commit in the box's config repo, with the person as author.** The workspace is
    the box's own config (config.json, skills, scripts), never anyone's code; the UI calls it "the
    box's config repo" wherever it comes up. The committer is `Workbench <workbench@localhost>`.
    Admin-tool writes take the author from `x-wb-actor`. Hand edits are not committed by the app;
    the workspace's `CLAUDE.md` tells agents to commit their own config edits with a clear message.
    (Briefly removed on 2026-10-16, then restored at the user's direction once it was clear this is
    only the box's config.)
58. **Saves are refused while `config.json` is invalid.** The app keeps running on the last good
    config and a banner names the errors on every page. A save over a broken file would either
    lose the hand edit or bake the error in.
59. **Diverged config repo.** When the remote and the box have both moved, saves still land in the
    file but commits pause, and a banner says so with a "Check again" button. The workbench never
    force-pushes or merges; a person resolves it with git.
60. **Pushes are debounced by 3 seconds and pulls are fast-forward only**, every 5 minutes and
    whenever a `workspace.updated` event arrives.
61. **The config schema is published into the workspace** at `.workbench/config.schema.json` and
    committed, so editors validate `config.json` with no network access.
62. **Zellij's socket folder is per data folder** (`/tmp/wb-zj-<hash>`), so two boxes on one
    machine (a test copy beside the live one) never share sessions.
63. **Skills are linked into run folders one by one.** A repo's own `.claude/skills/<name>` wins over
    a workspace skill with the same name.
64. **The standing terminal is `shell`, not `claude`.** Terminals are listed in `config.json`;
    old canvas windows on the `claude` session are pointed at `shell` on start.
65. **Dev identity also uses a `wb-dev-as` cookie**, set when a tab opens with `?as=`, because
    iframes and websockets cannot send the `x-wb-as` header. Dev mode still refuses production.
66. **The door asks the app.** Caddy's `forward_auth` calls `/auth/check` before serving
    terminals, sync, previews, devtools and code-server. The app answers with the person's email
    and role, so one identity check covers every route.
67. **Settings live in `config.json`** under `settings` and are edited on the Settings page (tabs:
    General, Box config repo, People, Doors and sign-in, Limits, JSON). Fields left empty are not written, so defaults
    stay defaults and the file stays short. The box id is assigned once and a save can never change it.
68. **Webhook URLs are `<publicHooksUrl><path>`.** With no setting, local development falls back to
    `http://localhost:8080` (the supervisor's `WB_DEFAULT_HOOKS_URL`) and says so. A deployed box
    with neither shows the path alone, the line "The base URL is set by you in Settings; the
    workbench cannot see its own public address." and a link to Settings.
69. **Deployments seed public addresses once.** `WB_SEED_PUBLIC_HOOKS_URL` and
    `WB_SEED_PUBLIC_APP_URL` are written into settings on boot only while the setting is empty,
    committed as "Set public addresses from the deployment". After that a person owns them.
70. **URL checks.** Base URLs must be `http(s)://host[/path]` with no trailing slash. The config
    repo's remote must look like a git URL (`git@host:path`, `ssh://`, `https://`, `file://` or an
    absolute path).
71. **The sign-in mode is not a setting.** `AUTH_MODE` stays an environment variable of the box, so
    nobody can turn sign-in off by committing to the workspace. Settings only tune the proxy and
    OIDC modes.
72. **`defaultModel`** applies to workflows that do not choose a model; empty means Claude Code's
    own default.
73. **Secret names** are upper case letters, digits and underscores, up to 64 characters, so the
    same name works as an environment variable. Resolution is the store first, then the
    environment, so `.env` and container settings keep working and show as "from environment".
74. **File store**: `data/secrets.json`, mode 600 (re-tightened if loosened), written atomically.
    Other processes (the webhook listener) re-read it when its modification time changes, so a
    rotation applies to the very next delivery.
75. **Google Secret Manager store** (`WB_SECRETS=gcp`, `WB_GCP_PROJECT`): plain REST with the VM's
    metadata-server token, ids `<WB_GCP_SECRET_PREFIX><NAME>` (default prefix `workbench-`) labelled
    `managed-by=workbench`. Rotation adds a version; older versions stay in Secret Manager's history.
    Values are cached in memory and refreshed every minute. Tested against a local fake of the API
    only; no call to Google was made.
76. **A value leaves the server once**: in the response that generated it. Typed values are never
    echoed. Activity records who created, rotated or deleted which name, never the value.
77. **MCP secrets** are written as `${secret:NAME}` inside a workflow's MCP server env or headers. The
    launcher fills them into the run's own `mcp.json` (mode 600), and the run's permissions deny
    reading that file and the secrets file.
78. **Delete is refused while referenced**, listing every reference with a link. Sign-in secrets
    count only for the box's own `AUTH_MODE`.
79. **Agents can list secret names but not set them.** `list_secrets` is an admin tool; creating,
    rotating and deleting are for people, on the Secrets page or with `wb secrets` (which reads
    values from stdin so they stay out of shell history).
80. **Four verifiers, explained where you pick them.** `hmac` defaults to GitHub's header, sha256 and
    `sha256=` prefix, all changeable. Choosing the GitHub adapter locks the verifier to HMAC with the
    sentence "GitHub cannot be moved off HMAC". `none` shows a warning.
81. **URL tokens never appear after creation.** The Sources page shows `…/hooks/jira/<token>`;
    Generate shows the full URL with the token once. Deliveries are recorded under the source's own
    path, so the token is not stored in the database or logs.
82. **Generic sources** take `{type, summary, payload, actor}` as sent. `type` must look like
    `a.b-c`; a body without one is refused with 422 and recorded as rejected. Adapters and maps are
    refused on generic sources.
83. **The template's Jira source uses `url-token`**, and the live workspace was moved to it too.
84. **Repo clones are ordinary clones** in `data/repos/<name>`, so code-server and people in a
    terminal can browse them. A clean checkout of the default branch is fast-forwarded on each fetch;
    one with local changes is left alone and the Repos page says how far behind it is. Runs never
    start from it: each fetch is followed by `git worktree add -B wb/run-<id> data/work/run-<id>
    origin/<default>`.
85. **Fetches** happen every `fetchMinutes` (default 10), on "Fetch now", and at the start of every
    run in that repo. A failed fetch at run start still starts the run from the last fetched commit,
    and the error shows on the Repos page.
86. **Tokens travel as an HTTP header** (`http.extraHeader` through `GIT_CONFIG_*` environment
    variables), never in argv, the remote URL or `.git/config`. Credential helpers are switched off
    for repo git calls: on macOS the keychain helper hung a server process on a 401.
87. **Push limits** are a pre-push hook the workbench owns (`core.hooksPath` on the clone): no pushes
    unless the repo allows them, and inside a run only to `wb/run-<id>`. Runs on repo workflows are
    also denied `git push --no-verify`, changing `core.hooksPath` or `GIT_CONFIG*`, and reading the
    box's keys. The real guarantee is the key or token's own permissions on the git host, which the
    Repos page tells people to set.
88. **Credentials reach a run only when the repo allows pushes.** Read-only runs get no token and the
    clone's fetches are done by the app.
89. **Run commits are authored "Workbench run #<id>"** so history shows which run made them, and so
    commits work on a box with no global git identity.
90. **Run folders are pre-trusted for Claude Code.** Inside a git repo Claude Code looks for trust only
    up to the repo root, so every worktree would stop at "Do you trust this folder?". The launcher
    writes `projects[<run folder>].hasTrustDialogAccepted: true` into the box user's Claude config
    first, the same answer the dialog records, and re-checks it in case Claude Code rewrote the file.
    Found by a live run that sat on the dialog.
91. **Worktrees are removed with session cleanup**, print runs included; the local branch goes too,
    and a pushed branch stays on the remote. Removing a repo deletes its clone and is refused while
    workflows use it or live runs work in it.
92. **Database migrations** (part of item 14, built here because item 5 needed new run columns):
    `PRAGMA user_version` is the schema version; numbered migrations run once each in a
    transaction; the file is copied to `workbench.db.before-v<N>` before an existing database is
    migrated; a database from a newer build stops the app with a clear message (exit code 3).
93. **Terminals people open** are recorded in a `terminals` table (who, when, folder, first command)
    and run as Zellij sessions named `t-<name>-<4 hex>`. The session name never changes; renaming
    changes the title everyone sees. The command runs with `WB_ACTOR="Name <email>"` exported, then a
    login shell stays open.
94. **The picker shows four groups**: Standing (from `config.json`), Yours, Other people's (with who
    opened each, plus any session nobody registered), and Runs, collapsed by default. "Other
    people's" was added to the plan's three because the box is shared and those sessions exist.
95. **Who may rename or end a terminal**: the person who opened it, or an admin. Standing sessions
    are ended by changing config; run sessions end with their run.
96. **Starting folders** are the workspace, a cloned repo (`repo:<name>`), or an existing absolute
    folder; anything else is refused. `settings.limits.maxTerminals` (default 12) caps open terminals
    people made; standing and run sessions do not count.
97. **Window-specific menu items.** A window type can add items to its window menu; the Terminal
    window adds New, Rename and End session.
98. **Import from Claude Code** reads the box user's MCP servers from every scope: user and local
    (per project) in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR`), and project `.mcp.json` files in the
    workspace and each repo clone. The workbench's own server is left out. Listings mask values that
    look like secrets (keys such as token, secret, password, key, auth; values such as `Bearer …` or
    well-known token prefixes). `${VAR}` references are kept as they are.
99. **Importing moves inline secrets into the store** as `<SERVER>_<KEY>` (an Authorization header
    becomes `<SERVER>_TOKEN`, keeping a `Bearer ` prefix outside the secret), reusing a secret that
    already holds the same value. From the MCP tab the servers are added to the form and the person
    saves as usual; the admin tools and API can save directly.
100. **OAuth sign-ins carry into runs: verified.** On 2026-10-16 a local OAuth 2.1 MCP server
     (discovery, dynamic registration, PKCE, auto-approve; 127.0.0.1 only) was added with
     `claude mcp add --transport http` and signed in through `/mcp` as the box user. It was imported
     into a workflow with the import endpoint, and run 24 (Haiku, `--strict-mcp-config`, only that
     workflow's servers) called its tool with the stored token: the server logged a valid bearer and
     the run returned the tool's answer. The sign-in, server, workflow and terminal were removed
     afterwards. Runs reuse a sign-in when the workflow uses the same server name and URL.
101. **The supervisor drops inherited Claude Code session variables** (`CLAUDECODE`,
     `CLAUDE_CODE_SESSION_ID` and the rest of the run scrub list) at start, so `claude` in a box
     terminal keeps its transcripts even when the box was started from a Claude Code session. Found
     during the sign-in above.
102. **Pinned versions live in `versions.json`** (Node, Zellij, Caddy, code-server, Claude Code).
     `scripts/setup.sh`, `wb tools install` and the image all read it.
103. **`wb tools install code-server|claude-code|zellij|caddy`** installs into the tools folder
     (`WB_TOOLS_DIR`, on the data volume in the image) so installs survive image updates.
     code-server is the official release tarball (4.96.4, which bundles its own Node); Claude Code is
     the npm package at the pinned version. Setup installs code-server only when the workspace has
     `codeServer: true`.
104. **code-server runs with its own auth off on 127.0.0.1**, behind the door's identity check at
     `/code`, with its config, user data and extensions under `data/code-server` (nothing in the
     box user's home), workspace trust prompts off, and the welcome walkthrough skipped. It opens a
     generated `.code-workspace` with the workspace and the repos folder.
105. **Services page states for the editor**: "not installed" whenever it is missing (with the
     install command), "off" when installed but switched off, and running otherwise.
106. **Editor links**: with code-server on, a run's "changes" link opens its worktree in the editor
     (the patch view stays one click away) and the Skill tab has "open in editor". The Code window
     can show the workspace and repos, the workspace only, or one repo.
107. **Repo bookkeeping sits beside the clones** (`data/repo-hooks/`, `data/repos-state.json`) so the
     repos folder in the editor shows only repos.
108. **One image** (`Dockerfile` at the root): Node 24 on Debian bookworm-slim, the product in
     `/opt/workbench`, Zellij and Caddy baked in at the pinned versions, `tini` as PID 1 and the
     supervisor as the only process it starts. It runs as user `workbench` (uid 1000); the
     entrypoint starts as root only to hand a fresh root-owned volume to that user, then drops
     privileges with `setpriv`.
109. **The /data volume layout**: `/data/home` (HOME: Claude Code sign-in, MCP tokens, Zellij data,
     git identity), `/data/workspace`, `/data/internal` (the data folder: SQLite, Yjs, runs, repos,
     keys, secrets, logs, code-server data) and `/data/tools` (on PATH; `wb tools install` and
     `npm -g` put programs there). An image update replaces only `/opt/workbench`. Verified by
     replacing the container on the same volume: box id, settings, a stored secret, the deploy key,
     an installed Claude Code and the workspace history all came back.
110. **`/etc/profile.d/workbench.sh`** puts `/data/tools/bin`, the product's tools and `wb` on PATH,
     because Debian's `/etc/profile` resets PATH for the login shells that terminals start.
     `wb tools install` refuses to run as root on `/data` (use `docker exec -u workbench …`).
111. **Interrupted runs.** On start, a run that was starting, working or blocked without a live
     session, or idle with its session gone, becomes `interrupted`, not `failed`. Resume (run page)
     relaunches the same run row in the same folder with `--resume` on its Claude Code session and a
     one-line note instead of the original prompt. Stopped and failed interactive runs can be
     resumed the same way through the API.
112. **Last activity** is reported per kind at `/api/health` (unauthenticated, so a host can poll it):
     person (any change), view (page polling), terminal (a terminal opened through the door),
     delivery, run (now, while one is live). `lastActivity` excludes page views, because an idle
     open tab polls forever; a host that wants "nobody is looking" can use `byKind.view`.
113. **Cold start banner**: shown for 30 minutes after a start that had to recreate standing
     sessions on an existing database ("This box was asleep; terminals started fresh").
114. **External schedules**: `POST /hooks/_schedule/<source>` with `X-Workbench-Schedule-Secret`
     (the secret named in `settings.scheduler.secret`), only when the scheduler is `external`; the
     internal cron is off then. An optional `X-Scheduled-For` makes retries of the same slot count
     once.
115. **Management API** on port 8002, only when `WB_MANAGEMENT_TOKEN` (24+ characters) is set, bound
     to `WB_MANAGEMENT_HOST` (127.0.0.1 unless the host sets its private address). Endpoints:
     `GET /v1/info`, `/v1/health`, `/v1/usage?since=`, `PUT /v1/access`, `PATCH /v1/settings` (merged;
     box id kept), `POST /v1/door-secret/rotate` (new value returned once), and
     `GET|POST /v1/support`, `DELETE /v1/support/:id`. Changes are committed to the workspace as
     "Management API".
116. **Support access** grants have an email, a role (viewer unless set), a reason (required) and an
     expiry of 5 minutes to 24 hours (default 60). Creating, first use in each hour, and revoking
     are written to Activity.
117. **Limits**: queued runs wait while `maxConcurrentRuns` are starting, working or blocked, or while
     the data disk is at `diskStopPercent`; the oldest queued run starts when a slot frees. Live runs
     older than `maxRunSessionHours` are stopped every 10 minutes with a note. The Runs and Services
     pages show runs, queue, terminals, disk and the reason anything waits.
118. **Logs**: in prod mode the supervisor writes one JSON object per line to stdout and merges the
     fields of children that already log JSON (Caddy, Fastify). Files under `data/logs` stay for the
     in-app log views.
119. **Doors**: identity headers sent by clients are dropped before the door's own check; previews can
     never reach the app's internal ports; a private app door still accepts `/hooks/*`; `both` means
     the private networks plus the sign-in proxy's trusted addresses.
120. **The supervisor drops only Claude Code's session variables**: an earlier version also removed
     `WB_MANAGEMENT_TOKEN` and turned the management API off. Caught in the container test.
121. **Four identity modes behind one `identify()`**, chosen by `AUTH_MODE` (an environment variable,
     never a setting): `dev`, `iap`, `proxy`, `oidc`. Unknown values stop the app.
122. **Proxy mode trusts the email header only with proof**: the shared secret in
     `X-Workbench-Proxy-Secret` (value from the secrets store, compared in constant time), or a client
     address inside `auth.proxy.trustedCidrs`. The client address is the door's own `X-Wb-Peer`
     header, believed only when the request reached the app from the door on loopback; Caddy sets it
     from the TCP peer and overwrites anything a client sent. With neither a secret value nor a
     trusted network, nobody gets in. The email header is configurable
     (`X-Forwarded-Email` for oauth2-proxy, `Cf-Access-Authenticated-User-Email`,
     `X-Pomerium-Claim-Email`, `Tailscale-User-Login`) and IAP's `accounts.google.com:` prefix is
     removed. A header with several addresses is refused.
123. **OIDC mode is the box's own sign-in**: discovery from the issuer, authorization code with PKCE
     (S256), state and nonce in a signed 10-minute cookie scoped to `/auth`, client secret from the
     store, id token checked against the issuer's keys, issuer, audience and nonce, and
     `email_verified: false` refused. The session is an HMAC-signed cookie (`wb-session`, HttpOnly,
     SameSite=Lax, Secure when `publicAppUrl` is https) lasting `auth.oidc.sessionHours` (default 168);
     the role is looked up again on every request, so removing someone from the list locks them out
     at once. The callback is `<publicAppUrl>/auth/callback`, or the request's own address when unset.
     The key is `data/session.key`.
124. **Who gets in, and as what**: listed people get their role; a listed domain gets the default
     role; `WB_BOOTSTRAP_ADMIN` is always an admin; an active support grant gets its role. Beyond
     that: dev mode makes everyone an admin (a laptop), iap gives the default role (Terraform's list
     is the gate), proxy with an empty list gives the default role (the proxy's policy is the gate),
     and OIDC with an empty list admits nobody but the bootstrap admin, since an open issuer such as
     Google would otherwise let the whole internet in.
125. **The template's people list starts empty.** It used to list `dev@localhost` as admin, which
     would have travelled into every hosted box.
126. **Roles on every API call.** Reading needs only a sign-in. Members may start, steer, stop and
     resume runs, answer requests, and open, rename and end terminals (their own, or anyone's if
     admin). Everything that changes how the box works (settings, workflows, skills, rules,
     sources and test sends, secrets, repos, deploy key, workspace sync, service restarts, session
     cleanup, MCP import) is for admins. The rule table is `requiredRole()` in `app.ts`, tested route
     by route.
127. **Viewers are read-only everywhere.** The Yjs server drops a viewer's sync step 2 and update
     messages (the door's identity check sets `X-Wb-Role` on the websocket upgrade), so canvases
     cannot be changed even by a modified client, while awareness still flows so others see them.
     Terminals log viewers in with a Zellij read-only token (named `<email> (watch)`); a cookie
     records which kind a browser holds, so a change of role takes effect on the next terminal load.
     The UI disables controls with a disabled `fieldset` around forms and buttons, shows "Read only"
     badges, treats every canvas as locked, and marks viewers with an eye and "watching" in presence.
128. **Yjs cross-tab sharing (BroadcastChannel) stays off** in the browser, so a viewer's tab cannot
     hand edits to a member's tab in the same browser. Found while testing the viewer filter.
129. **The first admin** is `WB_BOOTSTRAP_ADMIN` when the deployment sets it; otherwise the first
     signed-in member to claim it on the Setup page, once, while the list has no admin. In proxy mode
     the list then gates the door, so the Setup page asks to add the team or a domain alongside.
130. **The box name** shows at the top of the sidebar and in every page title
     (`<page> · <box name>`); `/api/health` and the management API return the name and id.
131. **The disk hard stop applies only to a data volume.** On a laptop the data folder shares the
     system disk, which this machine had at 96.7%; blocking every run there would be wrong, so it
     warns instead. On a box (`WB_EXPECT_DATA_MOUNT=1` or a separate filesystem) runs wait at
     `diskStopPercent`.
132. **The GCP module** (`deploy/gcp`) runs the image on a private Container-Optimized OS VM with no
     external address, egress through Cloud NAT, and SSH only through IAP TCP forwarding. One HTTPS
     load balancer serves two hosts: the app host through IAP (websocket timeout 3600 seconds) to
     port 8080, and the hooks host without IAP to port 8081, where Caddy answers only
     `POST /hooks/...`. This replaces the two Cloud Run doors of the first design; one load balancer
     with host rules is simpler and keeps the box private.
133. **The IAP audience reaches the VM through project metadata** (`<name>-iap-audience`), because
     the backend service depends on the VM and the VM cannot carry the backend's id. The startup
     script waits for it.
134. **The data disk** is a separate `pd-balanced` disk with `prevent_destroy`, a daily snapshot
     policy (14 days, snapshots kept if the disk is deleted), formatted only when blank and mounted
     at `/var/lib/workbench`, which is the container's `/data`. Changing the image replaces the VM
     and reattaches the disk.
135. **Secrets on GCP** use Secret Manager with names prefixed `<name>-`; the VM's service account
     may administer only secrets with that prefix (an IAM condition) and list the rest.
136. **The GCP module passes `allowed_emails` to the box** as `WB_ALLOWED_EMAILS` too, so terminal
     tokens of people removed from Terraform's list are revoked.
137. **Compose** keeps the app's port unpublished and pins oauth2-proxy to `172.31.250.10` on its own
     network; the box trusts the email header only from that address. oauth2-proxy is pinned to
     7.7.1. An optional `tls` profile adds one Caddy that gets certificates for both host names.
     Walked through locally on Docker Desktop with a stand-in OIDC issuer.
138. **A Fly example and guide were added** although the plan's guide list has five. Fly is the
     platform the hosted version uses and the "done means" names it. Self-hosting on Fly uses the
     box's own OIDC sign-in, with hooks on the same host.
139. **`WB_SEED_SETTINGS`** (JSON) lets any deployment fill in settings that `config.json` has not
     set, such as door host names or the proxy's trusted address. Values already in the file win and
     nulls are skipped.
140. **The doors bind to the loopback addresses (127.0.0.1 and ::1) when the box runs natively** (`WB_DOOR_BIND` overrides) and to
     every interface in the container, so a laptop's box is not on the local network by default.
141. **Licence: FSL-1.1-MIT**, as the goal asks, instead of the plan's MIT; the licensor is written as
     "The Workbench Authors" until there is a legal entity. The text was written from the published
     FSL 1.1 template without fetching it (no outside calls were allowed), so compare it with
     fsl.software before the first public release. `TRADEMARKS.md` says the name is not licensed and
     that Claude and Claude Code are Anthropic's marks.
142. **THIRD_PARTY_NOTICES.md is generated** (`pnpm notices`) from `pnpm ls --prod` across the
     workspace: 275 packages, all permissive (MIT, ISC, BSD, Apache-2.0, BlueOak, 0BSD), with their
     licence texts, plus the programs the box runs. Claude Code is listed as installed by each box's
     owner, never bundled.
143. **Releases**: `package.json` carries the version (0.3.0); `pnpm release` regenerates the schema
     and notices, builds `workbench:<version>` with `WB_VERSION`, and writes
     `dist/workbench-<version>.tar.gz`. Nothing is pushed.
144. **The schema** is published at `schema/config.schema.json` (`pnpm schema`; a test fails when it
     is stale) and into each workspace at `.workbench/config.schema.json`, which the template's
     `$schema` points at so editors validate offline.
145. **Google appears only in optional integrations** named for it: `lib/gcp/iap.ts` (the `iap`
     mode), `lib/gcp/secret-manager.ts` (`WB_SECRETS=gcp`), the GCP module and its guide, and as one
     example OIDC issuer among several. The operating organisation appears nowhere in the product; the infra stack is
     its own file.
146. **The infra branch** now holds a few lines that instantiate the module from
     `git::https://github.com/example-org/workbench.git//deploy/gcp?ref=v0.3.0`, plus the organisation's variables.
     That address is a placeholder until the product is pushed there. A copy with the source pointed
     at the local module passes `terraform validate`. Uncommitted, unapplied.
147. **Roles are guard rails, not a wall, between members and admins.** Members have shells on the
     box, and a shell can read everything the box holds, including the admin token and the proxy
     secret. The guides say so. The boundary that holds is viewer versus everyone else: viewers get
     no typing terminal and cannot change canvases or call mutating APIs.
148. **Pages are one way, not the only way.** Every page that edits the workspace or the box carries a
     short note that the same thing can be done in a terminal, the editor or by asking `claude`:
     config sections are plain JSON, skills are plain files (and can live in a repo), secrets have
     `wb secrets` and environment variables, repos can be cloned by hand. The box is configured like
     a person's own Claude Code setup; the workbench adds inbound events, workflows and the shared UI.
149. **The workbench does not manage code repos** (2026-10-16, the user's direction; supersedes entries
     84 to 89 and 91, and plan item 5's Repos page). There is no Repos page, clone, fetch timer,
     per-run worktree, pre-push hook or changes view. People clone code in a terminal with their own
     credentials, and a workflow's skill says how runs branch, commit and push. Run trust (entry 90)
     stays. The live box's config dropped its empty `repos` section; old `repos` and `repo` keys are
     ignored when read.
150. **Workflows choose where runs work, nothing more.** `workdir` starts runs in any folder on the box
     (absolute, or relative to the workspace); empty gives each run a fresh folder. `addDirs` passes
     more folders with `--add-dir`. The workbench writes nothing into a named folder: the workflow's
     skills are linked into the run's own folder, which is added with `--add-dir`, because Claude
     Code loads skills from added folders. Runs sharing a working folder take turns unless the
     workflow allows parallel runs.
151. **The internal folder is called that.** In the image the data folder is `/data/internal`, and
     every box writes a `README.txt` there saying it is managed by the workbench and needs no one.
     The editor opens the box's config and the home folder by default, with "the whole box (/)" one
     click away; opening `/` by default would make VS Code watch the entire disk.
152. **Who is in a terminal, editor, preview or DevTools window** shows like a cell on a shared sheet,
     because the canvas cannot follow a pointer into those frames. Once someone clicks into one, it
     gets a ring in each person's colour
     (stacked when several people are in it) and a name tag above the window's corner, with
     "typing" for a terminal they are typing in and "watching" for viewers; clicking back onto the page clears it. Hovering alone shows no ring.
     While someone's pointer
     is inside a terminal, editor, preview or DevTools window, their canvas cursor is hidden, because
     it would otherwise sit stuck at the edge. Other windows show nothing extra: the live cursor is
     already exactly where the person is.
153. **Ending a terminal moves every window showing it to `shell`**, and a Terminal window never loads
     a session that is not running. Zellij's web client creates a session it cannot find, so a
     window left on an ended terminal brought it straight back. Found by the end-to-end tests, which
     kept recreating their own test terminals.
154. **Listing Zellij sessions gives up after 5 seconds.** Zellij 0.45.1 once left a force-deleted
     session's server running but unresponsive, and `zellij ls` then waited on it forever. The stuck
     server was killed by hand; the timeout keeps pages working if it happens again.
155. **Outbound internet is always on** (2026-10-16, the user's decision). The box and its terminals
     reach the internet freely, with no box-level switch. Runs may use `WebSearch` and `WebFetch`
     (round 1 denied both) unless their workflow turns web access off (`webAccess: false`, the "Web
     access" checkbox on Guards & tools), which removes both tools and denies them. Runs still deny
     reading the box's own credentials (admin token, secrets file, keys, their MCP config) and still
     start with `--no-chrome`, which keeps them from driving a person's own Chrome through Claude in
     Chrome; that is not internet access. The checkbox's hint names the risk: web pages can carry
     instructions for the agent, so a workflow that holds write tools or tokens and has no need for
     the web is better with it off.

## Updates and rollback (2026-10-16)

156. **Updates cover the workbench only** (the user's direction). An update changes the image, the
     database and internal folder, and the config repo's format. Claude Code, `/data/tools`, the box
     user's home and anything else installed in the box are the people's to keep current; nothing
     in the update path pins, updates, checks or warns about them. `versions.json` still says what
     `wb tools install` puts in a box the first time.
157. **The compat floor lives in a `workbench_meta` table** next to `user_version`, created outside the
     numbered migrations. Adding it changed no schema version, so 0.3.0 still runs on data 0.4.0 has
     touched. Data from a newer build with no recorded floor is treated as having a floor equal to its
     schema, so it is refused.
158. **Breaking migrations are marked in the list** with `floor` (their own version) and
     `breaking: { reason, codeStoppedIn }`. A test fails when a migration raises the floor without the
     marker, when its SQL drops or renames something without it, or when `codeStoppedIn` is not an
     earlier release than the one shipping the migration. The code was checked for SQL that depends on
     column order (`insert` without a column list); there is none.
159. **0.4.0 has compat floor 1 and `minUpgradeFrom` 0.3.0**, the first release with the one-volume
     image. `minUpgradeFrom` is a constant in `packages/app/src/release.ts`. The product is now 0.4.0,
     and a box running from a checkout reports `package.json`'s version instead of "dev", so the
     update checks have a version to compare.
160. **`wb update` decides by capabilities, not version numbers.** The manifest lists what a release
     can do (drain, backup, update record, self-restore, compat floor). From a build without
     self-restore, a target that would leave data that build cannot read is refused before anything
     changes.
161. **Config keeps what it does not know.** Every save puts back keys this build's schema drops, at
     every level, matching list items by `id`, `name` or `email`; deleting a thing takes its unknown
     keys with it. The JSON tab writes exactly what the person typed, since it shows the raw file. A
     config that has never been valid since start now loads its valid parts (entries with errors left
     out, bad settings back to defaults) instead of an empty config; saves stay refused until it is
     fixed.
162. **Drain is in memory, so any restart ends it.** It is one more "blocked" reason in the limits,
     so queued runs wait and everything else (terminals, requests, the UI) keeps working. The routine
     waits up to 15 minutes by default (`timeoutSeconds`, capped at a day) for runs that are starting,
     working or blocked; idle sessions do not count, since a restart marks them interrupted and they
     resume. `wb admin drain`, `undrain`, `backup` and `backups` reach the same code through the
     local admin API, for boxes without a management token.
163. **Backups hold the database, the config repo and `secrets.json`.** The database through SQLite's
     online backup, the config repo with its `.git` and without `node_modules`, secrets only with the
     file store (Secret Manager keeps its own versions). Folders are mode 700, the secrets copy 600.
     The newest five are kept, plus the one an update in progress depends on. Canvases, run folders,
     keys and the home folder are left to volume snapshots: no update changes their format.
164. **The old build restores itself.** When a build starts on data it cannot read and an update
     record names a backup it can read, it restores that backup before opening the database. That
     makes "put the old image back" the whole rollback on every platform, including ones where
     nothing can reach the volume while the new image crash-loops. The database is always restored,
     and the one it replaces is kept beside the backup. `secrets.json` and `config.json` are restored
     only when the build cannot read them; config as a commit, so the config repo's history stays one
     line and its remote does not diverge. The goal said "restores the backup only when the new schema
     is above the old image's floor"; this reads it as "when the new data's floor is above the old
     image's schema", the condition under which the old image cannot read the data.
165. **The update record** (`/data/internal/update.json`) goes pending, then applied (the target
     started), then done; or rolled-back, restored or abandoned. Finishing files it in its backup's
     folder. Starting another update while one is in progress is refused.
166. **`wb update` runs outside the box** and drives a platform script with four commands
     (`current-image`, `snapshot`, `swap`, `manifest`). Each driver pins the image in the deployment's
     own file (`.env`, the tfvars file, `fly.toml`) and keeps the previous one as `*.before-update`.
     Defaults: 600 seconds for the new version to report healthy, 900 for the drain, polls every 3
     seconds, log in `~/.workbench/updates`. Exit codes: 0 updated, 1 stopped before changing
     anything, 2 rolled back, 3 neither version up. The GCP driver leaves Terraform's own prompt in
     place unless `WB_TF_AUTO_APPROVE=1`. Compose has no volume snapshot, so the box's backup is the
     fallback there. The CLI needs only Node built-ins, so an unpacked release tarball runs it.
167. **The management API is reachable for updates and nowhere else.** Compose publishes 8002 on
     the host's loopback; the GCP module publishes it on the VM and its firewall lets only IAP's
     range reach 22 and 8002; Fly binds it to the private network (`fly-local-6pn`). Without a token
     it stays off, as before.
168. **Healthy means `ok` with the target version** from `/v1/health`, which now also reports the
     schema version, the drain and the update state. One good answer is enough; the image's own
     health check and the platform's keep watching after that.
169. **The release manifest is generated in the image build** (`/opt/workbench/release.json`), copied
     out by `pnpm release` to `dist/workbench-<version>.release.json`, and put at the root of the
     tarball. The image is labelled with its version.
170. **Upgrade tests run the previous release's real code**: the newest older tarball in `dist/`,
     unpacked into the system temp folder once per version and installed offline from pnpm's store,
     on throwaway folders and ports 28200 to 28206, with Zellij and Claude Code replaced by `false`
     and a clean environment. A fresh clone has no older tarball, so those tests skip there.

## Round 5: the public repo, docs site and hosted product (2026-10-17)

The plan for this round is CLOUD-PLAN.md, which lives in the private cloud repo (`../donkeybox-cloud`)
and never in this one. Entries here cover the product side; the cloud repo keeps its own DECISIONS.md.

171. **CLOUD-PLAN.md moved to the cloud repo before the first commit**, so it is not in this repo's
     history at all. The plan said it "belongs in the cloud repo once that exists"; it existed as soon
     as step 1 started.
172. **The GitHub organisation is assumed to be `donkeybox`**: the repository is
     `github.com/donkeybox/donkeybox` and the image `ghcr.io/donkeybox/workbench`. Every deploy file,
     guide and the release script use these, replacing the `your-org` placeholders, so a self-hoster
     pulls the official image. If the organisation name differs, it is one search and replace. The
     product's image name stays `workbench`, the name the box uses for itself everywhere.
173. **The public name is DonkeyBox; "the workbench" stays the product's own word for a box.** README,
     docs site, licence notice and trademarks say DonkeyBox. The app, the CLI (`wb`), the image name
     and every page inside a box are unchanged: renaming them is a product change of its own, not
     needed for anything in this round.
174. **Licensor: "The DonkeyBox Authors" is a placeholder for the legal entity.** The licence text was
     checked against the official FSL-1.1-MIT template (getsentry/fsl.software); it now matches it
     word for word and line for line, with only the year and licensor filled in. A real licensor
     (a company or a person) must replace the placeholder before the first push; it is the one
     licensing item a build cannot decide.
175. **`docs/` holds every page, as plain Markdown with frontmatter.** `hostingGuides/` moved to
     `docs/hosting/` (its README became `index.md`, the site's folder page), the in-app Guide moved to
     `docs/product/guide.md`, and each file's first heading became a `title` in frontmatter, with a
     one-line `description`. GitHub shows frontmatter as a small table; the in-app Guide strips it and
     shows the title as its heading. Historical files (PLAN.md, earlier DECISIONS and CHECKLIST
     entries) keep the old path, as written at the time.
176. **The in-app Guide reads `docs/product/guide.md` directly**, imported raw by Vite from the repo, so
     the app and the site can never disagree. Its links to app routes (`/runs`, `/settings`) stay; on
     the site they are shown as plain text, because those routes exist only inside a box.
177. **The docs site is its own pnpm workspace with its own lockfile** (`apps/docs/pnpm-workspace.yaml`),
     not a member of the product workspace. Adding it to the product workspace would put React
     Router, Fumadocs and Tailwind into the product lockfile and break the image's frozen install,
     which copies only the product packages. `apps/` and `.github/` are in `.dockerignore`, and the
     release tarball leaves out `apps/`. `pnpm docs:dev` and `pnpm docs:build` at the root install and
     run it.
178. **The site is static: React Router in SPA mode with every page prerendered**, plus static search
     (Orama's `staticGET`), `llms.txt`, `llms-full.txt` and a Markdown copy of each page. It started
     from Fumadocs' own `react-router-spa` template. The template's Open Graph image route (takumi) was
     dropped: it is the one part that needs a renderer at build time, and nothing needs it yet.
179. **Pages live at the root of docs.donkeybox.com** (`/hosting/fly`, not `/docs/hosting/fly`). The
     home page needs an explicit index route that reuses the page module: a splat route does not match
     `/` when React Router prerenders.
180. **Links are written for GitHub and rewritten for the site** by a small remark plugin: relative
     `.md` links become routes (anchors kept), links out of `docs/` become GitHub links, absolute paths
     become plain text. It resolves folders when a file is compiled, never when the module loads, since
     the same module is loaded in the browser (an early version called Node's `path` at load and broke
     hydration on every page).
181. **`draft: true` keeps a page out of production builds**, and a folder whose pages are all drafts
     is left out with them (otherwise its `meta.json` shows an empty folder in the sidebar). Drafts
     build in `pnpm docs:dev`. The only cloud page is a draft until the hosted product launches.
182. **Deployed as a static Caddy image on Fly** (`apps/docs/Dockerfile`, `fly.toml`, app
     `donkeybox-docs`), by `.github/workflows/docs.yml` on pushes to `main` that touch `docs/` or
     `apps/docs/`, with a deploy token scoped to that app. Fly rather than Cloudflare Pages because the
     company already runs on Fly; the deploy is a Caddyfile and a two-line Dockerfile either way. Unknown paths return a real
     404 that serves the app shell, which renders Not Found in the docs layout. Pull requests,
     including from forks, only build the site in CI and never see the token.
183. **"Edit this page" links to GitHub's editor** for the page's file in `docs/`, next to Fumadocs' own
     copy-Markdown and open-in actions.
184. **The release manifest is also an image label**, `org.donkeybox.release` (compact JSON), plus the
     standard OCI `source`, `licenses` and `version` labels. `scripts/release.sh` computes the manifest
     from source and passes it as a build argument; after the build it reads the label back and the
     file inside the image, and fails the release if they differ.
185. **`wb manifest IMAGE` reads that label without running the image**: from the local Docker engine
     if it has the image, otherwise from the image's registry over the OCI distribution API, with an
     anonymous pull token (GHCR and Docker Hub allow it for public images), picking linux/amd64 from a
     multi-arch index. Node built-ins only, so a release tarball runs it. The compose and GCP drivers
     use it and fall back to running the image for releases before 0.5.0; the Fly driver, which could
     not read a manifest at all, now can, so `--manifest` is optional everywhere.
186. **`scripts/release.sh --push` builds linux/amd64 and linux/arm64 with buildx** and pushes
     `<version>` and `latest`. Fly and most clouds run amd64 while release machines are often Apple
     silicon, so a single-arch push from a laptop would not run on Fly. Without `--push` it builds for
     the local machine only, as before. The default image name became `ghcr.io/donkeybox/workbench`.
187. **0.5.0 is the first release with the label.** The version moved to 0.5.0 for it, and for the docs
     move; the schema is unchanged (4, floor 1), so 0.3.0 and 0.4.0 both upgrade straight to it.
188. **Upgrade tests cover every release from `MIN_UPGRADE_FROM` up to this one**, not only the newest
     older one. Each tarball in `dist/` in that range gets the full set (upgrade, rollback, refusals,
     self-restore). One assertion depended on the oldest release predating compat floors; it now reads
     the earlier release's capabilities from its manifest. CI downloads those tarballs and manifests
     from the GitHub releases before running the tests; a repository with no releases skips them with
     a visible note.
189. **Earlier releases are installed under `~/.cache/workbench/`**, not the system temp folder (macOS
     pruned files out of a cached 0.3.0 install there, which broke it) and not under `node_modules`
     (Node refuses to strip TypeScript types there).
190. **Three workflows**: `ci.yml` (setup, typecheck, unit and upgrade tests, Playwright against a box
     started in the job, and the docs site's typecheck, tests and build, uploaded as an artefact),
     `docs.yml` (deploy), `release.yml` (a `v<version>` tag that matches package.json: multi-arch push
     and a GitHub release with the tarball and manifest). All pass actionlint. None has run on GitHub
     yet: there is no remote.
191. **Public-project files**: SECURITY.md (GitHub private vulnerability reporting, or
     security@donkeybox.com), the Contributor Covenant 2.1 as CODE_OF_CONDUCT.md (official text, contact
     conduct@donkeybox.com), issue templates, and `docs/LICENSE` with the official CC BY 4.0 legal code.
     Both addresses need the domain's mail set up before the first push.
192. **One design system across the box, the docs and the cloud, taken from Amiral's colour
     playground.** `packages/app/web/src/tokens.css` is the source: oklch tokens, five elevation
     rungs, orange and teal eleven-step ramps used by role, fixed status fills with text-safe inks,
     eight categorical slots, a pastel tag palette, light and dark re-stepped. The docs import it by
     path; the cloud keeps a byte-for-byte copy checked by a test. The shadcn components are Amiral's
     versions (Phosphor icons swapped for lucide). The `donkeybox-ui` skill holds the rules.
193. **Orange is the brand ramp, teal the counterpoint**, the reverse of Amiral: the playground's own
     "brand ramp" switch, chosen because the mark and the landing design are orange. Info stays teal,
     since an orange info would sit beside serious. White on the orange fill measures 4.52:1.
194. **Token values are measured by a test** (`test/tokens.test.ts`): 44 text pairs at 4.5:1 and five
     marks at 3:1 in both themes, the elevation ladder, and the presence colours. The `/design` page
     prints the same ratios from the same code (`web/src/lib/color.ts`).
195. **Presence colours are the eight chart hues at lightness 0.52**, as hex (they travel to other
     browsers and into SVG attributes): white name tags clear 5:1 and every colour clears 3:1 on both
     canvases. The old palette was eight Tailwind 600s.
196. **Fonts are self-hosted** (`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`),
     production dependencies so their OFL licences land in THIRD_PARTY_NOTICES.md: a box may have no
     internet. Code shows no ligatures (`-<` must not become an arrow).
197. **The mark is `brand/mark.svg`; `packages/app/scripts/favicons.ts` renders every icon from it**:
     an SVG favicon in the reader's theme ink, an ICO (16, 32, 48), a 32px PNG and a 180px touch icon on
     the dark card. The view box is cropped to the mark so a 16px icon is not mostly air.
198. **Either theme can be scoped to a subtree** (`.light` / `.dark`), and the `dark:` variant stops
     at a `.light` subtree, so `/design` shows both themes at once.
199. **The landing clips are recorded from the real image, with a scripted model** (`demo/`). Claude
     Code, OpenCode and code-server run on a box from this checkout's image with a stock bash; four
     browsers sign in through the proxy mode; their cursors are the product's own presence. Only Jira
     (`bin/jira`, a file) and the model are stand-ins: `demo/model/server.ts` answers the Messages API
     with scripted turns, so tools run for real and every take is the same, and no key or sign-in goes
     into a container. `DEMO_MODEL=real` forwards to the real API for live takes.
200. **Zellij gets a config folder that exists** (`ZELLIJ_CONFIG_DIR`, the folder of its config file).
     Zellij ignores a session's `--default-layout` when its own config folder is missing, which it
     always is in a fresh box home: every terminal on a hosted box started as a bare shell in
     `/opt/workbench`, ignoring its folder, title and command. Macs usually have the folder, which is
     why it never showed in development. Found while recording the demo.
201. **The image gives terminals a normal shell**: `SHELL=/bin/bash` (without it Zellij fell back to
     `sh`), `TERM=xterm-256color` for the panes (without it `less`, git's pager, warned "terminal is not
     fully functional" and swallowed keys), and Debian's stock `.bashrc`, `.profile` and `.bash_logout`
     copied into the box user's home on first start, never over a person's own.
202. **A person opening several terminals at once gets one terminal token.** Two sign-ins in flight both
     made a Zellij token and renamed it to the person's email, and the second failed on the unique name
     ("UNIQUE constraint failed: tokens.name"). `tokenFor` now shares the token being made.
203. **The demo's shared coding agent is OpenCode, logged in once on the box**, and Claude Code runs the
     workflows. A personal Claude subscription is for one person, so the pages never say "share your
     Claude login"; they say one box, one set of credentials.
204. **The long pieces (a day on the box, the hero loops) are composed in our own HTML stage, frame by
     frame** (`demo/compose.mjs`, `demo/compose/`). Looked at: Remotion (React, a headless browser that
     seeks each frame; the best known, but a company licence from four people, and a second React app
     beside the site), Motion Canvas and its fork Revideo (MIT, but one canvas element: no HTML, so none
     of the site's type and tokens, and embedded video is awkward), HyperFrames (HeyGen's Apache-2.0
     "seek, don't play" HTML renderer built for agents; the closest fit, but a framework with its own
     skills, and its deterministic mode is Linux-only), screen-recorder tools with auto zoom (demo-dev,
     Fovea, Recordly, playwright-recast: built for one continuous recording, not chat bubbles over
     several), plain ffmpeg filters (crop, zoom and overlay work; typography and layout don't), and
     Rive, Lottie or a Figma export (made for drawn animation, not footage). What we need is the same idea
     as Remotion and HyperFrames: a page that draws any instant on request, stepped a frame at a time
     and screenshotted, then encoded. Our footage is already JPEG frames with timestamps and marks, which
     is the pre-decoding those frameworks do for video; the stage is about 250 lines of plain JS, uses
     the site's fonts and tokens in both themes, and needs nothing but the Playwright and ffmpeg the rig
     has. A piece is data (layers with eased keys: footage with crops, bubbles, a clock, text, drawings),
     so a change is a line, and a re-take re-renders without touching the piece.
205. **A skill run by hand just does the job; the Inbox is for runs nobody is watching.** With a person
     at the keyboard, asking them through the Inbox and waiting is a detour. The demo's estimate skill
     splits a ticket itself when a person runs it and opens what it did in a Document window; when a new
     ticket starts it as a workflow run, it posts the split to the Inbox and ends, and the answer (the
     workflow's own buttons, each with its prompt) starts the next run. Agents make workflows the way
     the person asks: no forced default for autonomy.
206. **Document windows**: a markdown file on the box, rendered and kept up to date (`doc` window type,
     `GET /api/docs`, `wb open FILE.md`, the `open_document` admin tool). `wb open` puts it beside the
     terminal it was typed in (by its Zellij session), so a proposal reads as a page, not terminal
     text. Only `.md` files under the workspace, the home folder or `/tmp`, after following links, and
     up to 1 MB; `wb open` is refused inside runs.
207. **Licence: MIT, for the open-source release.** FSL-1.1-MIT (decision 141) was there to keep a
     competing hosted service off the code while DonkeyBox Cloud was planned. There is no hosted
     product any more, so there is nothing for it to protect, and MIT is what people expect from a
     project that wants forks and pull requests. `docs/` stays CC BY 4.0. With the hosted product
     gone, the project's home is its GitHub repository: the docs are read there (`apps/docs` still
     builds the site locally), and images are published to `ghcr.io/<owner>/donkeybox`. The
     `org.donkeybox.release` image label keeps its name: it is a label namespace, not a domain anyone
     has to own, and `wb update` and `wb manifest` read it from every image built so far.
