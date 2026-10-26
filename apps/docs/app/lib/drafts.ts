/** Drafts out, and with them any folder left with no published page (its meta.json would show an empty folder). */
export function withoutDrafts<F extends { type: string; path: string; data: unknown }>(files: F[]): F[] {
  const pages = files.filter((f) => f.type === 'page' && !(f.data as { draft?: boolean }).draft);
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  return files.filter((f) => {
    if (f.type === 'page') return pages.includes(f);
    const dir = dirOf(f.path);
    return dir === '' || pages.some((p) => p.path.startsWith(`${dir}/`));
  });
}
