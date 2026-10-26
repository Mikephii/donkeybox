// Links in docs/ are written for GitHub: relative paths to other .md files and to product folders.
// On the site they become routes (`../hosting/fly.md#2-security` -> `/hosting/fly#2-security`), links
// out of docs/ go to the file on GitHub, and absolute paths (the in-app Guide's links to `/runs`,
// `/settings`) are app routes that do not exist here, so they are kept as plain text.
import path from 'node:path';
import type { Link, Parent, Root } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';

export interface DocLinkOptions {
  /** Absolute path of the docs/ folder. */
  docsDir: string;
  /** Absolute path of the repository root, for links out of docs/. */
  repoDir: string;
  /** e.g. https://github.com/mikephii/donkeybox/blob/main */
  githubBlob: string;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

export function rewriteDocLink(url: string, fromFile: string, o: DocLinkOptions): string | null {
  if (EXTERNAL.test(url)) return url;
  if (url.startsWith('/')) return null;
  const hashAt = url.search(/[?#]/);
  const target = hashAt < 0 ? url : url.slice(0, hashAt);
  const suffix = hashAt < 0 ? '' : url.slice(hashAt);
  const abs = path.resolve(path.dirname(fromFile), target);
  const inDocs = path.relative(o.docsDir, abs);
  if (!inDocs.startsWith('..') && !path.isAbsolute(inDocs) && /\.mdx?$/.test(inDocs)) {
    const slug = inDocs.replace(/\.mdx?$/, '').split(path.sep).join('/').replace(/(^|\/)index$/, '');
    return `/${slug}${suffix}`;
  }
  const inRepo = path.relative(o.repoDir, abs).split(path.sep).join('/');
  return `${o.githubBlob}/${inRepo}${suffix}`;
}

/**
 * Folders are given relative to the build's working folder (apps/docs) and resolved when a file is
 * compiled, so nothing here runs Node APIs when the module is loaded in the browser.
 */
export function remarkDocLinks(opts: { docsDir: string; repoDir: string; githubBlob: string }) {
  return (tree: Root, file: { path?: string; history?: string[]; cwd?: string }) => {
    const from = file.path ?? file.history?.[0];
    if (!from) return;
    const cwd = file.cwd ?? process.cwd();
    const o: DocLinkOptions = { docsDir: path.resolve(cwd, opts.docsDir), repoDir: path.resolve(cwd, opts.repoDir), githubBlob: opts.githubBlob };
    visit(tree, 'link', (node: Link, index, parent: Parent | undefined) => {
      const next = rewriteDocLink(node.url, from, o);
      if (next !== null) {
        node.url = next;
        return;
      }
      if (parent && index !== undefined) {
        parent.children.splice(index, 1, ...node.children);
        return [SKIP, index];
      }
    });
  };
}
