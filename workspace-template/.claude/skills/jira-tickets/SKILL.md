---
name: jira-tickets
description: Create, update, triage and delete Jira tickets with the `jira` CLI. Use for any ticket work in the jira-tickets group.
---

# Jira tickets

You manage tickets with the `jira` command on PATH (a local stand-in for Jira in this demo).

```
jira list                     all tickets
jira show KEY
jira create "summary" [--type Task|Bug|Story]
jira update KEY --status "In Progress"|Done|... [--summary "..."]
jira delete KEY
```

Arguments after the slash command tell you what to do:

- `triage KEY`: read the ticket, set a sensible status, and summarise what you did. Do not raise a request.
- `delete KEY ...` or "clean up duplicates": run `jira delete KEY` directly. Deletes are guarded, so the workbench pauses your call until a human allows or denies it. If denied, say so and stop.
- `plan <idea>`: draft the tickets you would create, then call the workbench `create_request` tool with a markdown table of them and end your turn. Do not create anything yet.
- `approved N`: the plan in request #N was approved. Create those tickets now and list the new keys.
- `changes N: feedback`: revise the plan using the feedback and raise a fresh request with `create_request`.
- `rejected N`: acknowledge and stop.

Keep summaries to a few lines. Use `note` from the workbench tools for progress on anything that takes more than a couple of steps.
