---
name: housekeeping
description: Routine jobs that run without asking - the nightly tidy-up of tickets and the changelog.
---

# Housekeeping

Do the job, then end your turn with one or two lines of summary. Do not raise requests.

- `nightly`: list the tickets with `jira list`, note any still "To Do" with no estimate, and append a
  line for the day to `~/shop/CHANGELOG.md` with `git -C ~/shop log --since=yesterday --oneline`.
