import { useEffect, useState } from "react";
import { LayoutDashboard, Lock, LockOpen, MoreHorizontal, Plus, Rows3 } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PresenceDots } from "@/components/PresenceDots";
import { cn } from "@/lib/utils";
import { useYMap } from "@/lib/hooks";
import { useCan } from "@/app/context";
import { useBoxName } from "@/app/BoxName";
import { canvases, doc, isLocked, newId, undoManager, windows, type CanvasSpec } from "@/lib/yjs";
import { SidePane } from "@/pane/SidePane";
import { AddWindowMenu } from "./AddWindowMenu";
import { tidy, tile } from "./arrange";
import { Canvas } from "./Canvas";
import { useMe, useSidePane } from "./context";
import { LAST_CANVAS } from "./Sidebar";

export function CanvasRedirect() {
  const all = useYMap(canvases);
  const sorted = [...all.values()].sort((a, b) => a.order - b.order);
  let last = "";
  try {
    last = sessionStorage.getItem(LAST_CANVAS) ?? "";
  } catch {}
  const target = all.has(last) ? last : sorted[0]?.id;
  return target ? <Navigate to={`/c/${target}${location.search}`} replace /> : <div className="p-8 text-sm">No canvases.</div>;
}

export function CanvasPage() {
  const { canvasId } = useParams();
  const all = useYMap(canvases);
  const pane = useSidePane();
  const canvas = canvasId ? all.get(canvasId) : undefined;
  // Viewers see every canvas as locked: they can watch, not rearrange.
  const viewer = !useCan("member");
  const locked = isLocked(canvas) || viewer;

  const box = useBoxName();
  useEffect(() => {
    if (canvas) document.title = `${canvas.title} · ${box}`;
  }, [canvas?.title, box]);
  useEffect(() => {
    if (canvasId && canvas)
      try {
        sessionStorage.setItem(LAST_CANVAS, canvasId);
      } catch {}
  }, [canvasId, canvas]);

  // Cmd/Ctrl+Z undoes your own layout changes; Shift adds redo. Not while typing, and not while locked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      if (locked) return;
      if (e.shiftKey) undoManager.redo();
      else undoManager.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  if (!canvasId || !canvas) return <CanvasRedirect />;
  const sorted = [...all.values()].sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvasToolbar canvas={canvas} canvases={sorted} locked={locked} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="canvas-panel" minSize="30" className="min-w-0">
          <Canvas canvasId={canvasId} locked={locked} />
        </ResizablePanel>
        {pane.kind && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="pane" defaultSize="40" minSize="22" className="min-w-0">
              <SidePane />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function CanvasToolbar({ canvas, canvases: list, locked }: { canvas: CanvasSpec; canvases: CanvasSpec[]; locked: boolean }) {
  const canEdit = useCan("member");
  const me = useMe()!;
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const go = (id: string) => navigate(`/c/${id}${location.search.replace(/[?&]pane=[^&]*/, "")}`);

  const toggleLock = () =>
    canvases.set(canvas.id, { ...canvas, locked: !locked, unlockedBy: locked ? { email: me.email, name: me.name, at: new Date().toISOString() } : null });

  const addCanvas = () => {
    const id = newId();
    const title = `Canvas ${list.length + 1}`;
    // A new canvas starts unlocked by whoever made it: creating it is the start of an edit.
    canvases.set(id, { id, title, order: (list.at(-1)?.order ?? 0) + 1, locked: false, unlockedBy: { email: me.email, name: me.name, at: new Date().toISOString() } });
    go(id);
    setRenaming(id);
    setName(title);
  };
  const removeCanvas = (id: string) => {
    if (list.length <= 1) return;
    doc.transact(() => {
      for (const [wid, w] of windows.entries()) if (w.canvasId === id) windows.delete(wid);
      canvases.delete(id);
    });
    if (id === canvas.id) go(list.find((c) => c.id !== id)!.id);
  };
  const commitRename = () => {
    if (renaming && name.trim()) {
      const c = canvases.get(renaming);
      if (c) canvases.set(renaming, { ...c, title: name.trim() });
    }
    setRenaming(null);
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" data-testid="canvas-tabs">
        {list.map((c) =>
          renaming === c.id ? (
            <Input key={c.id} autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commitRename} onKeyDown={(e) => e.key === "Enter" && commitRename()} className="h-7 w-36" />
          ) : (
            <div key={c.id} className="group flex items-center">
              <Button variant={c.id === canvas.id ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5" onClick={() => go(c.id)} onDoubleClick={() => (setRenaming(c.id), setName(c.title))}>
                {isLocked(c) ? null : <LockOpen className="size-3 text-status-warning-ink" />}
                {c.title}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`${c.title} options`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => (setRenaming(c.id), setName(c.title))}>Rename</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" disabled={list.length <= 1 || isLocked(c)} onSelect={() => removeCanvas(c.id)}>
                    Delete canvas{isLocked(c) ? " (unlock first)" : ""}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ),
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={addCanvas} disabled={!canEdit} aria-label="New canvas"><Plus /></Button>
          </TooltipTrigger>
          <TooltipContent>New canvas</TooltipContent>
        </Tooltip>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <PresenceDots subject={`canvas:${canvas.id}`} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={locked ? "ghost" : "outline"}
              size="sm"
              className={cn("h-8 gap-1.5", !locked && "border-status-warning/60 text-status-warning-ink")}
              onClick={toggleLock}
              disabled={!canEdit}
              data-testid="lock-toggle"
              data-locked={locked ? "true" : "false"}
            >
              {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
              {locked ? "Locked" : `Editing${canvas.unlockedBy ? ` · ${canvas.unlockedBy.email === me.email ? "you" : canvas.unlockedBy.name}` : ""}`}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {locked
              ? "Layout is locked for everyone. Terminals, buttons and forms still work. Click to unlock."
              : `Unlocked${canvas.unlockedBy ? ` by ${canvas.unlockedBy.name} at ${new Date(canvas.unlockedBy.at).toLocaleTimeString()}` : ""}. Windows can be moved, resized, added and closed. Click to lock.`}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" data-testid="arrange" disabled={locked}>
              <LayoutDashboard className="size-4" /> Arrange
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => tidy(canvas.id)} data-testid="arrange-tidy">
              <Rows3 className="size-4" /> Tidy <span className="ml-auto text-xs text-muted-foreground">keep sizes</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => tile(canvas.id)} data-testid="arrange-tile">
              <LayoutDashboard className="size-4" /> Tile to screen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AddWindowMenu canvasId={canvas.id} locked={locked} />
      </div>
    </header>
  );
}

