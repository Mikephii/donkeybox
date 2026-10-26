# Security

## Reporting a vulnerability

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/mikephii/donkeybox/security/advisories/new).
Please do not open a public issue.

Include what you found, how to reproduce it, and which release and hosting guide it affects.
DonkeyBox is maintained in spare time, so this is best effort: I aim to acknowledge a report within a
week, keep you told of progress, and credit you in the release notes unless you would rather I did
not.

## What is in scope

The code in this repository: the app and its doors (`proxy`, `oidc`, `iap` and `dev` sign-in), the
management API, the webhook listener and its verifiers, the secrets store, the image and the deploy
files. Anything that lets someone into a box without passing its door, lets a viewer act, lets a run
reach the admin tools or the secrets file, or reads a secret back after it was stored, is in scope.

Out of scope: what people run inside their own box (a box is a shared machine, and everyone allowed
in can open a shell on it, as the hosting guides say), Claude Code itself, and third-party programs
listed in THIRD_PARTY_NOTICES.md, which should go to their own projects.

## Supported releases

Security fixes land in the newest release. A box on an older release updates with `wb update`
([Updating a box](docs/hosting/updating.md)); every release states the oldest release that may
upgrade straight to it.
