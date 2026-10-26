import { useSyncExternalStore } from "react";

/** Each person's pan and zoom per canvas. Kept in sessionStorage as a convenience; never shared. */
export interface Viewport {
  x: number;
  y: number;
  z: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
const DEFAULT: Viewport = { x: 0, y: 0, z: 1 };
const vps = new Map<string, Viewport>();
const listeners = new Set<() => void>();
let size = { w: 1200, h: 800 };

const key = (id: string) => `wb-vp-${id}`;

export function getViewport(canvasId: string): Viewport {
  let v = vps.get(canvasId);
  if (!v) {
    try {
      const raw = sessionStorage.getItem(key(canvasId));
      v = raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
    } catch {
      v = DEFAULT;
    }
    vps.set(canvasId, v!);
  }
  return v!;
}

export function setViewport(canvasId: string, v: Viewport) {
  const next = { x: Math.round(v.x), y: Math.round(v.y), z: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z)) };
  vps.set(canvasId, next);
  try {
    sessionStorage.setItem(key(canvasId), JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

export function setCanvasSize(w: number, h: number) {
  size = { w, h };
}

export function canvasSize() {
  return size;
}

/** The visible area in canvas coordinates. */
export function visibleRect(canvasId: string) {
  const v = getViewport(canvasId);
  return { left: -v.x / v.z, top: -v.y / v.z, width: size.w / v.z, height: size.h / v.z };
}

/** Zoom by `factor` keeping the canvas point under (sx, sy) (container coordinates) still. */
export function zoomAt(canvasId: string, sx: number, sy: number, factor: number) {
  const v = getViewport(canvasId);
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * factor));
  const px = (sx - v.x) / v.z;
  const py = (sy - v.y) / v.z;
  setViewport(canvasId, { z, x: sx - px * z, y: sy - py * z });
}

export function fitTo(canvasId: string, rects: { x: number; y: number; w: number; h: number }[]) {
  if (!rects.length) return setViewport(canvasId, DEFAULT);
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const pad = 40;
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((size.w - pad * 2) / (maxX - minX), (size.h - pad * 2) / (maxY - minY), 1)));
  setViewport(canvasId, { z, x: (size.w - (maxX - minX) * z) / 2 - minX * z, y: (size.h - (maxY - minY) * z) / 2 - minY * z });
}

export function useViewport(canvasId: string): Viewport {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getViewport(canvasId),
  );
}
