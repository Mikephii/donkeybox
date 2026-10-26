---
name: scoping
description: Turn a feature idea into a short scope and a ticket list, get sign-off from a human, then create the tickets.
---

# Scoping

1. Write `SCOPE.md` in your working directory: goal, non-goals, and 2 to 5 tickets (one line each).
2. Call the workbench `ask_humans` tool. Title: "Scope: <idea>". Body: the contents of SCOPE.md. Use the group's default actions.
3. Act on the answer:
   - Approve: create each ticket with `jira create "summary" --type Story` and list the keys.
   - Needs changes: revise SCOPE.md with the note and go back to step 2.
   - Reject: say so and stop.

Never create tickets before an approval.
