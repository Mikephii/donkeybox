import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'DonkeyBox';
/** The site is only docs, so pages live at the root: /hosting/fly, not /docs/hosting/fly. */
export const docsRoute = '/';
export const docsContentRoute = '/llms.mdx';

export const gitConfig = {
  user: 'mikephii',
  repo: 'donkeybox',
  branch: 'main',
};
export const githubBlob = `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}`;

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}
