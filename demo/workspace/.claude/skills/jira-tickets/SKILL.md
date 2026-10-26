---
name: jira-tickets
description: Create, update, triage and clean up Jira tickets with the `jira` command. Use for any ticket work in the tickets workflow.
---

# Jira tickets

You manage Acme's tickets with the `jira` command on PATH.

```
jira list                     all tickets
jira show KEY
jira create "summary" [--type Task|Bug|Story] [--estimate N] [--parent KEY]
jira update KEY --status "In Progress"|Done|... [--summary "..."]
jira comment KEY "text"
jira delete KEY
```

- `triage KEY`: read the ticket, set a sensible status, and summarise what you did.
- `clean up duplicates`: list the tickets, find duplicates, and run `jira delete KEY` for each. Deletes
  are guarded: the box pauses the call until a person allows or denies it. If denied, say so and stop.

Keep summaries to a few lines.
