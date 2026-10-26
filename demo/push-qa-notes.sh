#!/usr/bin/env bash
# Runs inside the box: what lands when Sam pushes the QA notes skill and its workflow from his laptop.
# (A box with a workspace remote pulls a push like this on its own; the demo puts it there directly.)
set -euo pipefail
export WB_ACTOR="Sam <sam@acme.dev>"
mkdir -p /tmp/push
cat > /tmp/push/SKILL.md <<'SKILL'
---
name: qa-notes
description: After a PR merges, read what changed and attach QA notes to its Jira ticket. Use for /qa-notes REPO #N.
---

# QA notes

`/qa-notes REPO #N "TITLE" by AUTHOR` runs when GitHub says a pull request merged.

1. Read the merge in the repo's checkout (`~/shop` for acme/shop): `git log -1 --stat` and `git show`.
2. Find the ticket key (DK-123) in the branch name or the title. No key: say so and stop.
3. Write 3 to 5 QA notes a tester can follow: what to check, where, and the edge cases the diff suggests.
4. `jira comment KEY "QA notes for REPO #N: ..."`, then `jira update KEY --status "In QA"`.

Do not raise requests; this workflow runs on its own. End with one line: the ticket and what you did.
SKILL
cat > /tmp/push/group.json <<'JSON'
{ "title": "QA notes", "description": "After a PR merges, attach QA notes to its ticket.", "skill": "qa-notes",
  "autonomy": "autonomous", "model": "haiku", "workdir": "/data/home/shop", "allowedTools": ["Bash(git:*)", "Bash(jira:*)"] }
JSON
cat > /tmp/push/rule.json <<'JSON'
{ "id": "qa-notes-on-merge", "on": "github.pull_request.merged", "group": "qa-notes", "mode": "print", "title": "QA notes: {{payload.repo}} #{{payload.number}}",
  "prompt": "/qa-notes {{payload.repo}} #{{payload.number}} \"{{payload.title}}\" by {{payload.author}}" }
JSON
wb admin skills put qa-notes --file /tmp/push/SKILL.md >/dev/null
wb admin workflows put qa-notes --file /tmp/push/group.json >/dev/null
wb admin rules put --file /tmp/push/rule.json >/dev/null
