---
name: housekeeping
description: Routine follow-ups that run without asking - changelog lines after merges, deploy notes, nightly tidy-ups, and the goal-loop counter demo.
---

# Housekeeping

Do the job, then end your turn with one or two lines of summary. Do not raise requests.

- `post-merge REPO #N "TITLE" by AUTHOR`: append `- YYYY-MM-DD REPO #N TITLE (AUTHOR)` to `CHANGELOG.md` in your working directory (create it if missing). Get the date with `date +%F`.
- `deploy ENV SHA`: append `- YYYY-MM-DD deployed SHA to ENV` to `DEPLOYS.md`.
- `nightly`: count the lines in any `*.md` files here with `wc -l` and report them.
- `count`: append the next integer to `goal.txt` (start at 1 if the file is missing; read it first). Add exactly ONE line per turn, then end your turn immediately. A goal check decides whether you continue.
