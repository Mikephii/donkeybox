import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutDrafts } from '../app/lib/drafts.ts';

const page = (path: string, draft = false) => ({ type: 'page', path, data: { title: path, draft } });
const meta = (path: string) => ({ type: 'meta', path, data: { pages: [] } });

test('drafts and folders holding only drafts are left out; the root meta stays', () => {
  const files = [meta('meta.json'), page('index.md'), meta('guides/meta.json'), page('guides/index.md', true), meta('hosting/meta.json'), page('hosting/fly.md'), page('hosting/next.md', true)];
  assert.deepEqual(
    withoutDrafts(files).map((f) => f.path),
    ['meta.json', 'index.md', 'hosting/meta.json', 'hosting/fly.md'],
  );
});

test('a folder with one published page keeps its meta.json', () => {
  const files = [meta('guides/meta.json'), page('guides/index.md', true), page('guides/plans.md')];
  assert.deepEqual(withoutDrafts(files).map((f) => f.path), ['guides/meta.json', 'guides/plans.md']);
});
