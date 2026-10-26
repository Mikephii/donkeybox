import type { Config } from '@react-router/dev/config';
import { glob, readFile } from 'node:fs/promises';
import { createGetUrl, getSlugs } from 'fumadocs-core/source';

const getUrl = createGetUrl('/');
const DOCS = '../../docs';

/**
 * Every page on the site, without drafts: the same folders as app/lib/source.ts, so pages kept for
 * GitHub only (README.md, decisions.md) are left out. Rendered to static HTML: the site is files on a CDN.
 */
async function pages(): Promise<string[][]> {
  const out: string[][] = [];
  for await (const entry of glob(['index.md', 'product/**/*.{md,mdx}', 'hosting/**/*.{md,mdx}'], { cwd: DOCS })) {
    const text = await readFile(`${DOCS}/${entry}`, 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    if (/^draft:\s*true\s*$/m.test(fm)) continue;
    out.push(getSlugs(entry));
  }
  return out;
}

export default {
  ssr: false,
  async prerender({ getStaticPaths }) {
    const paths = [...getStaticPaths()];
    for (const slugs of await pages()) {
      paths.push(getUrl(slugs), `/llms.mdx/${[...slugs, 'content.md'].join('/')}`);
    }
    return paths;
  },
} satisfies Config;
