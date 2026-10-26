import { visibleRect } from "@/lib/viewport";
import { doc, windows, type WindowSpec } from "@/lib/yjs";

/** Matches the dotted background (20px). Every window edge lands on a dot. */
export const GRID = 20;
export const snap = (n: number) => Math.round(n / GRID) * GRID;
const GAP = GRID;

/** The visible area in canvas coordinates, whatever the pan and zoom. */
const viewport = (canvasId: string) => visibleRect(canvasId);

const onCanvas = (canvasId: string) =>
  [...windows.values()].filter((w) => w.canvasId === canvasId).sort((a, b) => a.y - b.y || a.x - b.x);

function write(list: WindowSpec[]) {
  doc.transact(() => list.forEach((w, i) => windows.set(w.id, { ...w, z: i + 1 })));
}

/** Packs windows into rows in reading order, keeping their sizes, within the visible width. */
export function tidy(canvasId: string) {
  const v = viewport(canvasId);
  const maxW = Math.max(GRID * 13, snap(v.width - GAP * 2));
  let x = GAP;
  let y = snap(v.top) + GAP;
  let rowH = 0;
  const out = onCanvas(canvasId).map((w) => {
    const ww = Math.min(snap(w.w), maxW);
    const hh = snap(w.h);
    if (x > GAP && x + ww > GAP + maxW) {
      x = GAP;
      y += rowH + GAP;
      rowH = 0;
    }
    const placed = { ...w, x: snap(v.left) + x, y, w: ww, h: hh };
    x += ww + GAP;
    rowH = Math.max(rowH, hh);
    return placed;
  });
  write(out);
}

/** Resizes windows into an even grid that fills the visible area. */
export function tile(canvasId: string) {
  const list = onCanvas(canvasId);
  if (!list.length) return;
  const v = viewport(canvasId);
  const cols = Math.ceil(Math.sqrt(list.length * (v.width / Math.max(v.height, 1)) * 0.75)) || 1;
  const c = Math.min(cols, list.length);
  const rows = Math.ceil(list.length / c);
  const cellW = Math.max(GRID * 13, snap((v.width - GAP * (c + 1)) / c));
  const cellH = Math.max(GRID * 7, snap((v.height - GAP * (rows + 1)) / rows));
  const ox = snap(v.left) + GAP;
  const oy = snap(v.top) + GAP;
  write(list.map((w, i) => ({ ...w, x: ox + (i % c) * (cellW + GAP), y: oy + Math.floor(i / c) * (cellH + GAP), w: cellW, h: cellH })));
}
