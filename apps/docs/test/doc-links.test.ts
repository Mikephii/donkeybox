import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rewriteDocLink } from '../app/lib/remark-doc-links.ts';

const o = { docsDir: '/r/docs', repoDir: '/r', githubBlob: 'https://github.com/mikephii/donkeybox/blob/main' };
const from = '/r/docs/hosting/updating.md';

test('sibling and cross-folder pages become routes, anchors kept', () => {
  assert.equal(rewriteDocLink('fly.md', from, o), '/hosting/fly');
  assert.equal(rewriteDocLink('own-computer.md#by-hand', from, o), '/hosting/own-computer#by-hand');
  assert.equal(rewriteDocLink('../product/guide.md', from, o), '/product/guide');
  assert.equal(rewriteDocLink('index.md', from, o), '/hosting');
  assert.equal(rewriteDocLink('../index.md', from, o), '/');
});

test('links out of docs/ go to GitHub', () => {
  assert.equal(rewriteDocLink('../../deploy/gcp', from, o), 'https://github.com/mikephii/donkeybox/blob/main/deploy/gcp');
  assert.equal(rewriteDocLink('../../LICENSE', from, o), 'https://github.com/mikephii/donkeybox/blob/main/LICENSE');
});

test('external links and anchors are untouched; app routes are dropped to text', () => {
  assert.equal(rewriteDocLink('https://fly.io', from, o), 'https://fly.io');
  assert.equal(rewriteDocLink('mailto:a@b.c', from, o), 'mailto:a@b.c');
  assert.equal(rewriteDocLink('#checklist', from, o), '#checklist');
  assert.equal(rewriteDocLink('/settings?tab=access', from, o), null);
});
