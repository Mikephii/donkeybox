import { randomUUID } from "node:crypto";

export const WINDOW_TYPES = ["terminal", "requests", "runs", "services", "preview", "devtools", "activity", "code", "doc"] as const;
export type WindowType = (typeof WINDOW_TYPES)[number];

export interface CanvasSpec {
  id: string;
  title: string;
  order: number;
  locked?: boolean;
  unlockedBy?: { email: string; name: string; at: string } | null;
}

export interface WindowSpec {
  id: string;
  canvasId: string;
  type: WindowType | "config";
  title?: string;
  description?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  props: Record<string, unknown>;
}

export const DEFAULT_SIZE: Record<WindowType, { w: number; h: number; props: Record<string, unknown> }> = {
  requests: { w: 520, h: 420, props: { groups: [] } },
  runs: { w: 520, h: 380, props: { live: true } },
  terminal: { w: 760, h: 520, props: { session: "shell" } },
  services: { w: 520, h: 360, props: {} },
  preview: { w: 640, h: 440, props: { port: 3333, path: "/" } },
  activity: { w: 560, h: 320, props: {} },
  devtools: { w: 760, h: 520, props: {} },
  code: { w: 980, h: 620, props: { target: "all" } },
  doc: { w: 560, h: 560, props: { path: "" } },
};

const GRID = 20;
const snap = (n: number) => Math.round(n / GRID) * GRID;

export interface UpsertWindow {
  id?: string;
  canvasId: string;
  type: WindowType;
  title?: string;
  description?: string;
  props?: Record<string, unknown>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** Shared canvases and windows as the server sees them. The Yjs document is the source of truth. */
export interface LayoutStore {
  ready(): Promise<void>;
  canvases(): CanvasSpec[];
  windows(canvasId?: string): WindowSpec[];
  upsertCanvas(input: { id?: string; title: string; locked?: boolean }): CanvasSpec;
  upsertWindow(input: UpsertWindow): WindowSpec;
  deleteWindow(id: string): boolean;
  /** Removes a canvas and its windows. */
  deleteCanvas(id: string): boolean;
}

/** Shared placement and validation, used by the Yjs-backed and in-memory stores. */
export function planWindow(input: UpsertWindow, existing: WindowSpec | undefined, siblings: WindowSpec[], canvases: CanvasSpec[]): WindowSpec {
  if (!WINDOW_TYPES.includes(input.type)) throw new Error(`unknown window type ${input.type}; use one of ${WINDOW_TYPES.join(", ")}`);
  if (!canvases.some((c) => c.id === input.canvasId)) throw new Error(`unknown canvas ${input.canvasId}`);
  const d = DEFAULT_SIZE[input.type];
  const right = Math.max(0, ...siblings.filter((w) => w.id !== existing?.id).map((w) => w.x + w.w));
  const base: WindowSpec = existing ?? {
    id: input.id ?? randomUUID().slice(0, 8),
    canvasId: input.canvasId,
    type: input.type,
    x: snap(right + GRID),
    y: GRID,
    w: d.w,
    h: d.h,
    z: Math.max(0, ...siblings.map((w) => w.z)) + 1,
    props: d.props,
  };
  return {
    ...base,
    canvasId: input.canvasId,
    type: input.type,
    title: input.title ?? base.title,
    description: input.description ?? base.description,
    props: { ...base.props, ...(input.props ?? {}) },
    x: input.x != null ? snap(input.x) : base.x,
    y: input.y != null ? snap(input.y) : base.y,
    w: input.w != null ? Math.max(260, snap(input.w)) : base.w,
    h: input.h != null ? Math.max(140, snap(input.h)) : base.h,
  };
}

export class MemoryLayoutStore implements LayoutStore {
  c = new Map<string, CanvasSpec>();
  w = new Map<string, WindowSpec>();
  async ready() {}
  canvases() {
    return [...this.c.values()].sort((a, b) => a.order - b.order);
  }
  windows(canvasId?: string) {
    return [...this.w.values()].filter((x) => !canvasId || x.canvasId === canvasId);
  }
  upsertCanvas(input: { id?: string; title: string; locked?: boolean }) {
    const id = input.id ?? randomUUID().slice(0, 8);
    const prev = this.c.get(id);
    const next: CanvasSpec = { id, title: input.title, order: prev?.order ?? this.c.size, locked: input.locked ?? prev?.locked ?? true, unlockedBy: prev?.unlockedBy ?? null };
    this.c.set(id, next);
    return next;
  }
  upsertWindow(input: UpsertWindow) {
    const next = planWindow(input, input.id ? this.w.get(input.id) : undefined, this.windows(input.canvasId), this.canvases());
    this.w.set(next.id, next);
    return next;
  }
  deleteWindow(id: string) {
    return this.w.delete(id);
  }
  deleteCanvas(id: string) {
    for (const w of this.windows(id)) this.w.delete(w.id);
    return this.c.delete(id);
  }
}
