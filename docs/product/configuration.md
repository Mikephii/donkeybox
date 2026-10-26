---
title: "Configuration"
description: "The workspace's config.json: settings, sources, workflows, rules, services and terminals."
---

A box's configuration is one file, `config.json`, at the root of its workspace: a git repo of its
own, created from `workspace-template/` on first start. Every save from the app or the admin tools is
validated against the whole file first and committed. An invalid file never takes the box down: the
last good configuration stays in force and every page shows the errors.

The full JSON schema is
[schema/config.schema.json](../../schema/config.schema.json); editors that read `$schema` complete
and check the file as you type.

## Sections

| Section | Shape | What it holds |
|---|---|---|
| `settings` | object | The box itself; see below. Edited on the Settings page. |
| `sources` | map of id to source | Inbound events: webhooks with a verifier, schedules, and the event types they emit. |
| `groups` | map of id to workflow | Workflows: the skill, autonomy and guards, notification, model, allowed tools, MCP servers, working folder and web access. |
| `rules` | list | Which events start which workflow, with a filter, prompt, goal and mode. |
| `services` | list | Long-running processes the box keeps up, with a probe. |
| `terminals` | list | Standing terminals: name, title, folder, command and layout. |

Workflow skills live beside the file in `.claude/skills/<name>/SKILL.md`, and helper scripts in
`bin/`, which is on every run's PATH.

## Settings

| Key | What it sets |
|---|---|
| `box.name`, `box.id` | The name shown in the sidebar and page titles; a stable id made on first start. |
| `publicAppUrl`, `publicHooksUrl` | The addresses people and webhook senders use. The box cannot see its own public address, so you set it. |
| `workspaceRemote` | Optional git remote for the workspace; pushed after each save, pulled fast-forward only. |
| `defaultModel` | The model runs use unless a workflow says otherwise. |
| `sessionRetentionHours`, `timezone` | How long finished run sessions are kept; the box's time zone for schedules. |
| `codeServer` | Whether code-server runs as a service. |
| `scheduler.mode` | `internal` (cron in the app; the box stays awake) or `external` (a host calls `/hooks/_schedule/<source>` at the right times, which also wakes a stopped box). |
| `access.users`, `access.domains`, `access.defaultRole` | Who gets in and as what: `admin`, `member` or `viewer`. |
| `limits` | Maximum concurrent runs, maximum run session age, disk warning and stop thresholds, maximum terminals. |
| `doors` | Which hostnames serve the app and the hooks listener, and whether the app door is public, private or both. |
| `auth.proxy` | For `AUTH_MODE=proxy`: the email and name headers, the shared secret's name, trusted networks. |
| `auth.oidc` | For `AUTH_MODE=oidc`: issuer, client id, the client secret's name, scopes and session length. |

Secrets are never in this file. Fields that need one hold the secret's name, resolved from the box's
secrets store and then the environment.
