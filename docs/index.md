---
title: "DonkeyBox"
description: "A shared box for running Claude Code agents as a team."
---

DonkeyBox (the workbench) is one box, a VM, a container or a laptop, where a team runs Claude Code
agents together. Webhooks and schedules start runs in workflows. Agents raise requests in an Inbox
when they need a person, and act alone when policy allows. People work on shared canvases of
terminals, editors, previews and run lists.

Each box is one Docker image with all of its state on one `/data` volume. The product decides as
little as it can: it handles inbound events, workflows and the shared screens, and leaves how agents
treat your code to your own skills.

## Start here

- [Getting started](product/index.md): run a box on your own machine in two commands.
- [Using the workbench](product/guide.md): how the parts fit, and a worked Jira example.
- [Hosting guides](hosting/index.md): run a box for a team on Google Cloud, AWS, Fly, any Linux host,
  your own computer, or behind your own app.
- [Updating a box](hosting/updating.md): swap the image, keep the volume, roll back if it fails.

## Reference

- [The `wb` command](product/cli.md)
- [Configuration](product/configuration.md): the workspace's `config.json`.

The source is on GitHub at [mikephii/donkeybox](https://github.com/mikephii/donkeybox)
under the MIT licence. These docs are CC BY 4.0. Every page has an "Edit this page" link; fixes are
welcome.
