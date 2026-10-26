import * as Y from "yjs";
import { fit, hex, PRESENCE_HUES, PRESENCE_L } from "./color";
import { WebsocketProvider } from "y-websocket";

export interface CanvasSpec {
  id: string; title: string; order: number;
  /** Shared edit lock. Missing means locked: canvases are locked unless someone unlocks them. */
  locked?: boolean;
  unlockedBy?: { email: string; name: string; at: string } | null;
}
export const isLocked = (c: CanvasSpec | undefined) => !c || c.locked !== false;
export type WindowType = "terminal" | "requests" | "runs" | "services" | "preview" | "devtools" | "activity" | "code" | "doc" | "config";
export interface WindowSpec {
  id: string; canvasId: string; type: WindowType; title?: string; description?: string;
  x: number; y: number; w: number; h: number; z: number;
  props: Record<string, any>;
}
export interface Presence {
  user: { email: string; name: string; color: string; role?: string };
  cursor: { canvasId: string; x: number; y: number } | null;
  /** The window someone is working in; focused: they clicked into its terminal or editor. */
  focus: { windowId: string; typing: boolean; focused?: boolean } | null;
  /** The window their pointer is over, so a cursor the canvas cannot follow into a frame is hidden. */
  hover?: string | null;
  pane?: string | null;
}

export const doc = new Y.Doc();
const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/yjs`;
export const provider = new WebsocketProvider(wsUrl, "workbench", doc, { disableBc: true });
export const canvases = doc.getMap<CanvasSpec>("canvases");
export const windows = doc.getMap<WindowSpec>("windows");
export const signals = doc.getMap<{ n: number; at: string; detail: Record<string, any> }>("signals");
export const awareness = provider.awareness;
/** Recently closed windows, shared, so anyone can bring one back. */
export const closed = doc.getMap<WindowSpec & { closedAt: number; closedBy?: string }>("closed");
/** Cmd+Z / Shift+Cmd+Z for your own layout changes (moves, resizes, closes, renames). Remote edits are not undone. */
export const undoManager = new Y.UndoManager([canvases, windows], { captureTimeout: 400 });

export const whenSynced = new Promise<void>((resolve) => {
  if (provider.synced) return resolve();
  const on = (s: boolean) => {
    if (s) {
      provider.off("sync", on);
      resolve();
    }
  };
  provider.on("sync", on);
});

// The eight categorical hues at one lightness (lib/color.ts PRESENCE_HUES); tokens.test.ts checks them.
export const presencePalette = PRESENCE_HUES.map(([h, c]) => hex(fit({ l: PRESENCE_L, c, h })));
export function colorFor(email: string): string {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return presencePalette[h % presencePalette.length]!;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Seeds the two starting canvases once. Fixed ids make concurrent first loads idempotent. */
export function seedIfEmpty() {
  if (canvases.size > 0) return;
  doc.transact(() => {
    canvases.set("work", { id: "work", title: "Work", order: 0, locked: true });
    canvases.set("ops", { id: "ops", title: "Ops", order: 1, locked: true });
    const w = (id: string, canvasId: string, type: WindowType, x: number, y: number, ww: number, hh: number, props: Record<string, any> = {}, title?: string) =>
      windows.set(id, { id, canvasId, type, x, y, w: ww, h: hh, z: 1, props, title });
    w("work-requests", "work", "requests", 20, 20, 520, 420, { groups: [] }, "All requests");
    w("work-runs", "work", "runs", 20, 460, 520, 360, { live: true }, "Live runs");
    w("work-terminal", "work", "terminal", 560, 20, 760, 560, { session: "shell" });
    w("work-jira", "work", "requests", 560, 600, 760, 220, { groups: ["jira-tickets"] }, "Jira tickets");
    w("ops-services", "ops", "services", 20, 20, 520, 360);
    w("ops-terminal", "ops", "terminal", 560, 20, 760, 520, { session: "services" });
    w("ops-preview", "ops", "preview", 20, 400, 520, 360, { port: 3333 });
    w("ops-activity", "ops", "activity", 560, 560, 760, 260);
  });
}
