# The Acme demo

The demo clips in the README are recorded from a real box: the product's Docker image with a stock
bash shell, four people in four browsers, and Claude Code, code-server and OpenCode running on it.
Only two things are stand-ins:

- **Jira** is `bin/jira` in the demo workspace, which keeps tickets in a file on the box.
- **The model** is `model/server.ts`, a stand-in for the Anthropic API that plays scripted turns
  (`model/scenarios.ts`). Claude Code and OpenCode are the real programs. They call real tools on the
  box (`jira`, `git`, `wb request`, the workbench MCP tools), and every take comes out the same. The
  same container also answers as `mcp.atlassian.com`, an MCP server with no sign-in, for the MCP clip.

With `DEMO_MODEL=real ANTHROPIC_API_KEY=sk-ant-...` the model forwards every call to the real API
instead. Takes then differ, and the scripted waits in `rig/clips.mjs` may need more time.

## Record

```sh
docker build -t donkeybox/workbench:demo .   # the image under test, from this checkout
demo/acme.sh up light                        # first time: builds the base volume (tools, shop repo)
node demo/record.mjs light                   # every clip, in order, into demo/out/light/
demo/acme.sh reset dark && node demo/record.mjs dark
```

`node demo/record.mjs light c6-terminal` records one clip. Clips run in order and each starts where the
last left the box (C4 makes the workflow C5 uses), so re-record from `c1` after a reset when in doubt.

### The second round: a day on the box, and the hero loops

```sh
node demo/record2.mjs light            # two takes, each on a fresh box: "workflow" (C4, C5 again) and "day"
node demo/compose.mjs light            # cuts m1-day and h0-h5 from the footage into demo/out/light/
node demo/compose.mjs light h4-zoom --still 2 6 9   # stills of a piece at those seconds, to check a cut
```

`record2.mjs` records C4 and C5 again, C15 (the canvas with three people, for the top of every page), C12–C14 (a ticket's estimate run posting a card and ending,
Kai's answer starting the next run, Alice running the skill by hand) and raw footage for the long
pieces: the day's beats, four people leaving and coming back, the same canvas in four browsers, and a
push landing. `compose.mjs` lays chat bubbles, a clock, zooms and drawings over that footage
(`compose/pieces.mjs` is the cut, `compose/stage.html` draws it) and encodes like the clips.

The box is at http://localhost:8090 while it is up. A browser needs the proxy headers to get in; the
recorder sends them (`X-Forwarded-Email: alice@acme.dev`, `X-Workbench-Proxy-Secret: acme-demo-proxy-secret`).

## What is where

| Path | What |
|---|---|
| `acme.sh` | Starts the model container and the box on a private network, builds the base volume once, resets between takes, fires the GitHub merge webhook. |
| `box-setup.sh` | Runs inside the box: installs Claude Code, code-server and OpenCode into the base; per take, the people's terminals, the canvases and last night's run. |
| `history.mjs` | Makes the box look a few days old: the nightly run at 02:00, a past Jira delivery, a saved workflow. |
| `workspace/` | The Acme workspace (the box's template): config, skills (`ticket-estimate`, `jira-tickets`, `housekeeping`), `bin/jira`. |
| `shop/` | `acme/shop`, a small app; `box-setup.sh` makes its git history, ending with PR #87 merged. |
| `model/` | The scripted model, its scenarios, and the MCP stand-in. |
| `rig/` | The recorder: people (browser contexts with proxy sign-in and smooth cursors), the camera (screencast frames re-timed to 30 fps), the clips. |
| `record.mjs` | Records the clips and the hero loop. |
| `record2.mjs`, `rig/scenes.mjs` | The second round: two takes from fresh boxes; clips plus raw footage for the long pieces. |
| `compose.mjs`, `compose/` | The compositor: each long piece as data, drawn frame by frame on an HTML stage and encoded. |
| `push-qa-notes.sh` | What lands on the box when Sam pushes the QA notes skill and its workflow from his laptop. |

## How it looks right

- The browser runs at a real 1.25x scale (`--force-device-scale-factor`), not an emulated one:
  headless WebGL draws terminal text at the wrong size under emulation. Frames come out 1600x1000.
- The camera is Chrome's screencast (a JPEG on every change), not Playwright's video, which is soft.
- Other people's cursors are the product's own presence: their browsers move real mice in small timed
  steps. The recorded person gets a drawn pointer, since a page does not show its own cursor.
- Every canvas shot has someone else's cursor moving (`rig/wander.mjs`). Wanderers stay off terminals
  and the editor: those are iframes, and a mouse inside one never reaches the canvas, so the others
  would see the cursor stop.
- The editor (code-server) is per browser: the camera only sees an edit made in its own browser. The
  terminal is shared, so anyone's typing shows in every browser.
