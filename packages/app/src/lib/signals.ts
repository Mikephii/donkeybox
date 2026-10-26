import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WebSocket from "ws";
import type { Notifier, SignalKind } from "../engine/types.ts";
import { planWindow, type CanvasSpec, type LayoutStore, type UpsertWindow, type WindowSpec } from "./layout.ts";
import { randomUUID } from "node:crypto";

/**
 * The app is a Yjs client of the y-websocket server. It never writes rows into Yjs;
 * it bumps a counter per data kind, and browsers refetch over REST when a counter moves.
 */
export class YjsNotifier implements Notifier, LayoutStore {
  doc = new Y.Doc();
  provider: WebsocketProvider;
  constructor(url: string, room = "workbench") {
    this.provider = new WebsocketProvider(url, room, this.doc, { WebSocketPolyfill: WebSocket as any, disableBc: true });
  }
  signal(kind: SignalKind, detail: Record<string, unknown> = {}) {
    const signals = this.doc.getMap<{ n: number; at: string; detail: Record<string, unknown> }>("signals");
    const prev = signals.get(kind)?.n ?? 0;
    signals.set(kind, { n: prev + 1, at: new Date().toISOString(), detail });
  }
  close() {
    this.provider.destroy();
  }

  // ── layout (admin tools write canvases and windows into the shared document) ──
  private cmap() {
    return this.doc.getMap<CanvasSpec>("canvases");
  }
  private wmap() {
    return this.doc.getMap<WindowSpec>("windows");
  }
  ready(): Promise<void> {
    if (this.provider.synced) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("layout sync timed out; is the Yjs server running?")), 5000);
      const on = (synced: boolean) => {
        if (!synced) return;
        clearTimeout(t);
        this.provider.off("sync", on);
        resolve();
      };
      this.provider.on("sync", on);
    });
  }
  canvases() {
    return [...this.cmap().values()].sort((a, b) => a.order - b.order);
  }
  windows(canvasId?: string) {
    return [...this.wmap().values()].filter((w) => !canvasId || w.canvasId === canvasId);
  }
  upsertCanvas(input: { id?: string; title: string; locked?: boolean }) {
    const id = input.id ?? randomUUID().slice(0, 8);
    const prev = this.cmap().get(id);
    const order = prev?.order ?? Math.max(-1, ...this.canvases().map((c) => c.order)) + 1;
    const next: CanvasSpec = { id, title: input.title, order, locked: input.locked ?? prev?.locked ?? true, unlockedBy: prev?.unlockedBy ?? null };
    this.cmap().set(id, next);
    return next;
  }
  upsertWindow(input: UpsertWindow) {
    const next = planWindow(input, input.id ? this.wmap().get(input.id) : undefined, this.windows(input.canvasId), this.canvases());
    this.wmap().set(next.id, next);
    return next;
  }
  deleteWindow(id: string) {
    if (!this.wmap().has(id)) return false;
    this.wmap().delete(id);
    return true;
  }
  deleteCanvas(id: string) {
    if (!this.cmap().has(id)) return false;
    this.doc.transact(() => {
      for (const w of this.windows(id)) this.wmap().delete(w.id);
      this.cmap().delete(id);
    });
    return true;
  }
}

export class NullNotifier implements Notifier {
  calls: { kind: SignalKind; detail?: Record<string, unknown> }[] = [];
  signal(kind: SignalKind, detail?: Record<string, unknown>) {
    this.calls.push({ kind, detail });
  }
}
