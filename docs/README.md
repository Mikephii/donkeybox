# Documentation

The project's documentation, as plain Markdown that reads here on GitHub. `apps/docs` builds the
same files into a docs site (`pnpm docs:dev` previews it).

| Folder | What |
|---|---|
| [index.md](index.md) | The site's home page |
| [product/](product/index.md) | Getting started, the Guide (also shown in the app), the CLI and configuration |
| [hosting/](hosting/index.md) | One guide per way of hosting, and updating a box |
| [decisions.md](decisions.md) | The design log: every default chosen while building, with the reason (GitHub only, not on the site) |

Writing a page:

- Start with frontmatter: `title`, `description`, and `draft: true` to keep it out of the published
  site while it is being written.
- Plain Markdown first. Link to other pages by their relative `.md` path, so the link works on
  GitHub and on the site. Links out of `docs/` (to `deploy/`, `schema/`) become GitHub links on the
  site.
- `meta.json` in each folder sets the sidebar order.
- Preview with `pnpm docs:dev` from the repo root.

The text in this folder is licensed CC BY 4.0 ([LICENSE](LICENSE)); the code around it is under the
repository's own license.
