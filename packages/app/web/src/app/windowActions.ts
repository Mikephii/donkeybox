import { toast } from "sonner";
import { awareness, closed, doc, windows, type WindowSpec } from "@/lib/yjs";
import { windowTitle } from "@/windows/registry";

const KEEP = 20;

export function closeWindow(spec: WindowSpec) {
  doc.transact(() => {
    windows.delete(spec.id);
    closed.set(spec.id, { ...spec, closedAt: Date.now(), closedBy: awareness.getLocalState()?.user?.email });
    const old = [...closed.values()].sort((a, b) => b.closedAt - a.closedAt).slice(KEEP);
    for (const o of old) closed.delete(o.id);
  });
  toast(`Closed ${windowTitle(spec)}`, { action: { label: "Undo", onClick: () => restoreWindow(spec.id) }, duration: 8000 });
}

export function restoreWindow(id: string) {
  const c = closed.get(id);
  if (!c) return;
  const { closedAt: _a, closedBy: _b, ...spec } = c;
  const z = Math.max(0, ...[...windows.values()].filter((w) => w.canvasId === spec.canvasId).map((w) => w.z)) + 1;
  doc.transact(() => {
    windows.set(id, { ...spec, z });
    closed.delete(id);
  });
}

export function updateWindow(id: string, patch: Partial<WindowSpec>) {
  const cur = windows.get(id);
  if (cur) windows.set(id, { ...cur, ...patch });
}
