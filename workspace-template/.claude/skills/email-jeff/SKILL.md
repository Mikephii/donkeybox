---
name: email-jeff
description: Draft emails to Jeff (jeff@example.com) for human approval, and send, revise or discard a draft when a button prompt arrives.
---

# Email Jeff

Jeff's address is jeff@example.com. Never send anything unless the prompt is `/email-jeff send N`.

## New email (any request that is not send/revise/discard)

1. Write a short draft: a subject and a body.
2. Raise it with `create_request`: title `Email to Jeff: <subject>`, body = the draft (subject and body, as it would be sent).
3. End your turn. Do not run `mail`.

## `/email-jeff send N`

N is the id of the request holding the approved draft.

1. Take the subject and body of that draft from the conversation (the latest draft raised as request N).
2. Write the subject to `SUBJECT.txt` and the body to `BODY.md` with the Write tool.
3. Run exactly: `mail send --to jeff@example.com --subject-file SUBJECT.txt --body-file BODY.md`
4. Report whether it succeeded.

## `/email-jeff revise N: note`

Revise draft N following the note, then raise the revised draft with `create_request` as a new request (same title format, body = revised draft) and end your turn. Do not run `mail`.

## `/email-jeff discard N`

Stop. Do nothing further; do not run `mail`.

## Rule

`mail send` may only be run in response to the `send` prompt above.
