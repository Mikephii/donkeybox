// Renders DonkeyBox's favicons from brand/mark.svg, so both surfaces (the box and the docs site)
// wear identical icons. Run it after changing the mark:
//   node packages/app/scripts/favicons.ts            writes into packages/app/web/public/
//   node packages/app/scripts/favicons.ts OUT_DIR    writes into OUT_DIR as well
// Writes favicon.svg (the mark in the ink of the reader's theme), favicon.ico (16, 32 and 48),
// favicon-32.png and apple-touch-icon.png (180, the mark on the dark card: iOS wants an opaque tile).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = [join(ROOT, "packages/app/web/public"), ...process.argv.slice(2).map((d) => resolve(d))];

// tokens.css as hex: the foreground in light and dark, and the dark card for the touch icon.
const INK = { light: "#0a0a0a", dark: "#f0efec", tile: "#1a1a18" };

// The mark's own box: its 200 by 200 canvas has room above the ears, which a 16px icon cannot spare.
const CROP = "25 41 150 150";

const source = readFileSync(join(ROOT, "brand/mark.svg"), "utf8");
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The mark as a standalone SVG: currentColor set by a style, so it follows the reader's theme. */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP}">
  <style>svg{color:${INK.light}}@media (prefers-color-scheme:dark){svg{color:${INK.dark}}}</style>
${inner.trim()}
</svg>
`;

/** The mark at a size, on a ground (or transparent), padded so it sits square in the tile. */
const page = (size: number, ink: string, ground: string | null, pad: number) => `<!doctype html>
<html><body style="margin:0;background:${ground ?? "transparent"}">
<div style="width:${size}px;height:${size}px;display:grid;place-items:center;color:${ink}">
<svg viewBox="${CROP}" width="${size - 2 * pad}" height="${size - 2 * pad}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>
</div></body></html>`;

/** An ICO holding PNG images (supported everywhere ICO is). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
const shot = async (size: number, ink: string, ground: string | null, pad: number) => {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(page(size, ink, ground, pad));
  const data = await p.screenshot({ omitBackground: ground === null, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
  return data;
};
const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await shot(size, INK.light, null, 0) })));
const touch = await shot(180, INK.dark, INK.tile, 30);
await browser.close();

for (const dir of OUT) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "favicon.svg"), favicon);
  writeFileSync(join(dir, "favicon.ico"), ico(small));
  writeFileSync(join(dir, "favicon-32.png"), small[1]!.data);
  writeFileSync(join(dir, "apple-touch-icon.png"), touch);
  console.log(`favicons written to ${dir}`);
}
