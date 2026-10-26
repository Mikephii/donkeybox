# Contributing

Thanks for helping. Contributions are welcome: bug fixes, docs, new or corrected hosting guides, and
features. DonkeyBox is maintained by one person in their spare time, so reviews may take a while.
For anything large (a new window type, a new door, a change to how runs or updates work), open an
issue first so we can agree on the shape before you build it.

A few things keep DonkeyBox (the workbench) easy to run and safe to host. Please read the
[code of conduct](CODE_OF_CONDUCT.md), and report security problems as [SECURITY.md](SECURITY.md)
says, not in an issue.

## Getting going

```sh
pnpm run setup     # Zellij and Caddy into .tools/bin, dependencies, Playwright, .env
pnpm start         # the whole box on http://localhost:8080, workspace created from workspace-template/
pnpm test          # vitest: engine, API, identity modes, secrets, repos, management API
pnpm test:e2e      # Playwright against the running box; leaves no trace
pnpm typecheck
```

Node 22.18 or newer runs the TypeScript directly; only the browser code is built.

## Where things go

- `packages/app`: the app, the engine, the supervisor, the webhook listener, the Yjs server, the web UI.
- `packages/cli` (`wb`), `packages/mcp` (the workbench MCP server), `packages/hooks` (Claude Code hooks).
- `workspace-template/`: what a new box's workspace starts as. Keep it a working demo.
- `deploy/`: the image entrypoint, the GCP Terraform module, compose and Fly examples.
- `docs/`: the documentation, as plain Markdown that reads on GitHub (see [docs/README.md](docs/README.md)).
  `docs/hosting/` has one guide per way of hosting, each with the same seven sections, and
  `docs/product/guide.md` is also the in-app Guide.
- `apps/docs/`: the docs site (Fumadocs on React Router). Its own pnpm workspace and lockfile, so the
  product image never carries it. `pnpm docs:dev` previews your docs change locally.
- `docs/decisions.md`: every default and every deviation from the plan, with the reason. Add to it when you
  choose something a reader would otherwise wonder about.

## Rules that keep it safe

- The app is never reachable without a door that proves who someone is. New routes go behind
  `identify()` and declare the role they need (`requiredRole()` in `app.ts`).
- Secrets are referenced by name. No API returns a value after it was created, nothing logs one, and
  nothing writes one into `config.json` or git.
- Runs never get the admin tools, the admin token, the secrets file or the box's keys.
- Database changes are new numbered migrations in `packages/app/src/engine/db.ts`; never edit an old one.
- After changing the config schema, run `pnpm schema` (a test fails until you do).
- After changing dependencies, run `pnpm notices` to regenerate THIRD_PARTY_NOTICES.md.

## Tests

Every backend change comes with vitest coverage and every page change with a Playwright test.
End-to-end tests run against the live box but must leave it as they found it: throwaway canvases,
config restored, requests closed, and no agent runs started.

## Pull requests

- One change per pull request. A bug fix and a refactor are two.
- Run `pnpm typecheck` and `pnpm test` locally, and `pnpm test:e2e` (with `pnpm start` running) for
  anything that touches a page. CI runs these and `pnpm docs:build` on every pull request.
- Say what you verified and how: the tests you added, and what you tried by hand.
- Update `docs/` in the same pull request when behaviour changes, and add an entry to
  [docs/decisions.md](docs/decisions.md) when you choose a default a reader would wonder about.
- Regenerate what is generated: `pnpm schema` after a config schema change, `pnpm notices` after a
  dependency change.

## Reporting bugs

Use the bug template: what happened, what you expected, how to reproduce it, and the release and
hosting guide. Never paste secrets, tokens or webhook payloads with personal data. Security problems
go through [SECURITY.md](SECURITY.md), not an issue. Questions and ideas are welcome in Discussions.

## Releases

Maintainers release by bumping `version` in `package.json`, running `pnpm release` to build the image,
tarball and manifest locally and check them, then pushing a `v<version>` tag. The release workflow
builds the multi-arch image, pushes it to `ghcr.io/<owner>/donkeybox` as `<version>` and `latest`,
and creates a GitHub release carrying the tarball and the manifest. Raise `MIN_UPGRADE_FROM` in
`packages/app/src/release.ts` when a release drops support for something older releases left behind.

## Licence

Inbound equals outbound: by contributing you agree your contribution is licensed under the
project's [licence](LICENSE) (MIT), and contributions to `docs/` under [CC BY 4.0](docs/LICENSE).
