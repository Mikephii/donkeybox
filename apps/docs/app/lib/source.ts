import { llms, loader } from 'fumadocs-core/source';
import { pageSchema } from 'fumadocs-core/source/schema';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineDocs } from 'fumadocs-mdx/macro';
import { z } from 'zod';
import { withoutDrafts } from './drafts';
import { remarkDocLinks } from './remark-doc-links';
import { docsRoute, githubBlob } from './shared';

// The content is the product repo's docs/ folder: plain Markdown that also reads on GitHub and in the
// in-app Guide. `draft: true` pages build in dev and are left out of production builds.
export const docs = defineDocs({
  dir: '../../docs',
  docs: {
    async: true,
    // docs/README.md is for GitHub only, so the folders are listed rather than '**/*'.
    files: ['index.md', 'product/**/*.{md,mdx}', 'hosting/**/*.{md,mdx}'],
    schema: pageSchema.extend({ draft: z.boolean().default(false) }),
    mdxOptions: applyMdxPreset({
      remarkPlugins: (v) => [
        [remarkDocLinks, { docsDir: '../../docs', repoDir: '../..', githubBlob }],
        ...v,
      ],
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

const all = docs.toFumadocsSource();

export const source = loader({
  source: import.meta.env.DEV ? all : { files: withoutDrafts(all.files) },
  baseUrl: docsRoute,
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
});
