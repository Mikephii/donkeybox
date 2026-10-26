---
name: ticket-estimate
description: Estimate a Jira ticket in story points, and split one that is really two pieces of work. Use for /ticket-estimate KEY.
---

# Ticket estimate

`/ticket-estimate KEY` estimates one ticket with the `jira` command.

1. Read it: `jira show KEY`.
2. If it is one piece of work, estimate it (1, 2, 3, 5 or 8 points), `jira estimate KEY N`, and say why in
   one line.
3. If it is more than one piece of work, propose the tickets as a markdown table (summary, points, why).

**Run by a person** (no `$WB_RUN_ID`): they are at the keyboard, so just do it. Split it yourself when
it is two jobs (`jira create "SUMMARY" --type Story --estimate N --parent KEY` for each, comment on the
original, set it to `Split`). Write what you did to `/tmp/KEY-estimate.md` and show it with
`wb open /tmp/KEY-estimate.md`.

**Run by a workflow** (a new ticket started it): nobody is watching, so a split goes to the team.
Write the table to `/tmp/KEY-split.md` and post it, then stop:

```sh
wb request --group estimates --title "Split KEY into N tickets?" --body-file /tmp/KEY-split.md
```

The workflow's own buttons (Approve, Needs changes, Reject) go on the card.

Whoever answers starts the next run: on approve, create the tickets as above and say who approved;
on changes, revise and post again; on reject, estimate the ticket as it is.

Keep the final summary to a short table of the tickets and their points.
