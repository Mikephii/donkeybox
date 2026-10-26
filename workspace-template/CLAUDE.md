# Workbench workspace

This folder is the configuration of one workbench box: its own settings, workflows, skills and
scripts. It is not anyone's code. It is a git repo, and the workbench commits every change made from
its pages or admin tools, with the person who made it as the author.

**When you change anything here yourself** (config.json, a skill, a script), commit it straight
away with a message that says what changed, for example:

```sh
git add -A && git commit -m "Add triage rule for SHOP issues"
```

The workbench pushes the box's config to its remote, if one is set in Settings, a few seconds after
each commit. Code repos you or the workflows work in are separate: how they are cloned, branched,
committed and pushed is up to the people and the skills, not this folder.

- `config.json`: settings, sources (webhooks and schedules), workflows (`groups`), rules, extra
  services, repos and standing terminals. `.workbench/config.schema.json` describes it.
- `.claude/skills/<name>/SKILL.md`: one skill per workflow. A workflow's runs can call its skill as
  `/<name>`.
- `bin/`: scripts on every run's PATH. `jira` and `mail` here are stand-ins that write to files in the
  data folder; they never contact a real system.

## Working here with Claude Code

Claude Code started in this folder has the workbench's setup tools (from `.mcp.json`): read
`setup_reference` first, then use `list_workflows`, `upsert_workflow`, `write_skill`, `upsert_rule`,
`upsert_source`, `test_source`, `list_repos`, `upsert_repo`, `new_terminal`, `upsert_window` and the rest. They validate every
change the same way the pages do. Prefer them over editing `config.json` by hand; if you do edit it,
the app keeps the last good version running and shows the errors on every page until it is fixed.

Secrets are referenced by name (for example `GITHUB_WEBHOOK_SECRET`) and live in the workbench's
secrets store, never in this repo.
