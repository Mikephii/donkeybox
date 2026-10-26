import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { ArrowUpRight, Info, Maximize, Minus, MoreHorizontal, Pencil, Plus, X } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePresence, useYMap } from "@/lib/hooks";
import { fitTo, getViewport, setCanvasSize, setViewport, useViewport, zoomAt } from "@/lib/viewport";
import { awareness, windows, type Presence, type WindowSpec } from "@/lib/yjs";
import { windowPage, windowTitle, windowTypes } from "@/windows/registry";
import { GRID, snap } from "./arrange";
import { closeWindow, updateWindow } from "./windowActions";
import { WindowSettingsDialog } from "./WindowSettingsDialog";

/** Throttle with a trailing call, and cancel() so a late trailing write cannot undo a final one. */
function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0;
  let t: ReturnType<typeof setTimeout> | null = null;
  const run = (...a: A) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...a);
    } else {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        last = Date.now();
        fn(...a);
      }, ms - (now - last));
    }
  };
  run.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
  };
  return run;
}

const typingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/**
 * The canvas: an infinite surface with no scrollbars. Hold Space and drag (or drag with the middle
 * mouse button) to pan, scroll or two-finger scroll to pan, Cmd/Ctrl+scroll or pinch to zoom.
 * Scrolling inside a window body scrolls that window instead.
 */
/** Windows whose body is an iframe: the canvas loses the pointer inside them, so they show who is in them instead. */
const FRAMED = new Set(["terminal", "code", "preview", "devtools"]);

export function Canvas({ canvasId, locked }: { canvasId: string; locked: boolean }) {
  const all = useYMap(windows);
  const presence = usePresence();
  const vp = useViewport(canvasId);
  const outer = useRef<HTMLDivElement>(null);
  const [interacting, setInteracting] = useState(false);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; id: number } | null>(null);
  const list = useMemo(() => [...all.values()].filter((w) => w.canvasId === canvasId), [all, canvasId]);

  // Track the container size for fit, tidy and placement.
  useEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(() => setCanvasSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Space to pan, as in Miro. Ignored while typing in a field; terminals keep their own keys.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typingTarget(e.target) || document.activeElement?.tagName === "IFRAME") return;
      e.preventDefault();
      if (!e.repeat) setSpace(true);
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Wheel: Cmd/Ctrl (and trackpad pinch, which arrives as ctrl+wheel) zooms; otherwise pans unless inside a window body.
  useEffect(() => {
    const el = outer.current!;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(canvasId, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)));
        return;
      }
      if ((e.target as HTMLElement).closest("[data-window-body]")) return;
      e.preventDefault();
      const v = getViewport(canvasId);
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      setViewport(canvasId, { ...v, x: v.x - dx, y: v.y - dy });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canvasId]);

  const toCanvas = (clientX: number, clientY: number) => {
    const r = outer.current!.getBoundingClientRect();
    const v = getViewport(canvasId);
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  };

  const sendCursor = useMemo(() => throttle((c: Presence["cursor"]) => awareness.setLocalStateField("cursor", c), 40), []);

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!(space || e.button === 1)) return;
    // Cancel the compatibility mouse events so windows do not start dragging.
    e.preventDefault();
    e.stopPropagation();
    outer.current!.setPointerCapture(e.pointerId);
    const v = getViewport(canvasId);
    pan.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, id: e.pointerId };
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (p && p.id === e.pointerId) {
      const v = getViewport(canvasId);
      setViewport(canvasId, { ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y });
      return;
    }
    const c = toCanvas(e.clientX, e.clientY);
    sendCursor({ canvasId, x: Math.round(c.x), y: Math.round(c.y) });
  };
  const endPan = (e: React.PointerEvent) => {
    if (pan.current?.id === e.pointerId) {
      pan.current = null;
      setPanning(false);
    }
  };

  // Focus inside a terminal counts as "typing" only when the person put it there with the pointer.
  useEffect(() => {
    const onBlur = () =>
      setTimeout(() => {
        const el = document.activeElement as HTMLIFrameElement | null;
        if (el?.tagName !== "IFRAME") return;
        if (!el.matches(":hover")) {
          el.blur();
          window.focus();
          return;
        }
        const wid = (el.closest("[data-window-id]") as HTMLElement | null)?.dataset.windowId;
        if (wid) awareness.setLocalStateField("focus", { windowId: wid, typing: el.getAttribute("data-terminal") === "1", focused: true });
      }, 0);
    const onFocus = () => {
      // Back on the page itself: no longer working inside a terminal or editor.
      const f = awareness.getLocalState()?.focus;
      if (f?.typing || f?.focused) awareness.setLocalStateField("focus", { ...f, typing: false, focused: false });
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Leaving the canvas leaves whatever window you were in.
  useEffect(() => () => (awareness.setLocalStateField("focus", null), awareness.setLocalStateField("hover", null)), []);

  const others = [...presence.entries()].filter(([cid, s]) => cid !== awareness.clientID && s.user);

  return (
    <div
      ref={outer}
      data-canvas-scroll
      data-testid="canvas"
      className="wb-canvas-bg relative h-full w-full touch-none overflow-hidden"
      style={{
        backgroundPosition: `${vp.x}px ${vp.y}px`,
        backgroundSize: `${GRID * vp.z}px ${GRID * vp.z}px`,
        cursor: panning ? "grabbing" : space ? "grab" : undefined,
      }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={() => sendCursor(null)}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
    >
      <div
        data-testid="canvas-layer"
        className={cn("absolute left-0 top-0 origin-top-left", (interacting || space || panning) && "wb-interacting")}
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.z})` }}
      >
        {list.map((w) => (
          <WindowFrame
            key={w.id}
            spec={w}
            scale={vp.z}
            locked={locked}
            onInteract={setInteracting}
            // Only windows the canvas cannot see into get the ring and name tags; elsewhere the cursor shows where people are.
            viewers={FRAMED.has(w.type) ? others.filter(([, s]) => s.focus?.windowId === w.id && s.focus.focused).map(([, s]) => s) : []}
          />
        ))}
      </div>
      {others
        // Inside a terminal or editor the canvas cannot follow the pointer; the window's outline shows them instead.
        .filter(([, s]) => s.cursor?.canvasId === canvasId && !(s.hover && FRAMED.has(list.find((w) => w.id === s.hover)?.type ?? "")))
        .map(([cid, s]) => (
          <RemoteCursor key={cid} p={s} left={vp.x + s.cursor!.x * vp.z} top={vp.y + s.cursor!.y * vp.z} />
        ))}
      <ZoomControls canvasId={canvasId} zoom={vp.z} rects={list} />
      {list.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {locked ? "This canvas is empty. Unlock it to add windows." : "Empty canvas. Use Add window to start."}
        </div>
      )}
    </div>
  );
}

function ZoomControls({ canvasId, zoom, rects }: { canvasId: string; zoom: number; rects: WindowSpec[] }) {
  const center = (factor: number) => {
    const el = document.querySelector<HTMLElement>("[data-canvas-scroll]");
    zoomAt(canvasId, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2, factor);
  };
  return (
    <div className="absolute bottom-3 right-3 z-[100001] flex items-center gap-0.5 rounded-lg border bg-background/95 p-0.5 shadow-sm backdrop-blur" data-testid="zoom-controls">
      <Button variant="ghost" size="icon" className="size-7" onClick={() => center(1 / 1.2)} aria-label="Zoom out" data-testid="zoom-out"><Minus className="size-3.5" /></Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="w-12 text-center font-mono text-xs tabular-nums" onClick={() => setViewport(canvasId, { x: 0, y: 0, z: 1 })} data-testid="zoom-level">{Math.round(zoom * 100)}%</button>
        </TooltipTrigger>
        <TooltipContent>Reset to 100%</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => center(1.2)} aria-label="Zoom in" data-testid="zoom-in"><Plus className="size-3.5" /></Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => fitTo(canvasId, rects)} aria-label="Fit to windows" data-testid="zoom-fit"><Maximize className="size-3.5" /></Button>
        </TooltipTrigger>
        <TooltipContent>Fit to windows</TooltipContent>
      </Tooltip>
    </div>
  );
}

function RemoteCursor({ p, left, top }: { p: Presence; left: number; top: number }) {
  return (
    <div className="pointer-events-none absolute left-0 top-0 z-[100000] transition-transform duration-75 ease-linear" style={{ transform: `translate(${left}px, ${top}px)` }} data-testid="remote-cursor">
      <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow">
        <path d="M1 1 L1 13 L4.5 9.5 L7 15 L9 14 L6.5 8.5 L11.5 8.5 Z" fill={p.user.color} stroke="white" strokeWidth="1" />
      </svg>
      <span className="ml-3 -mt-1 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow" style={{ background: p.user.color }}>
        {p.user.name}
        {p.user.role === "viewer" ? " · watching" : ""}
        {p.focus?.typing ? " · typing" : ""}
      </span>
    </div>
  );
}

function WindowFrame({ spec, scale, locked, onInteract, viewers }: { spec: WindowSpec; scale: number; locked: boolean; onInteract: (b: boolean) => void; viewers: Presence[] }) {
  const def = windowTypes[spec.type];
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const write = useCallback((patch: Partial<WindowSpec>) => {
    const cur = windows.get(spec.id);
    if (cur) windows.set(spec.id, { ...cur, ...patch });
  }, [spec.id]);
  const writeThrottled = useMemo(() => throttle(write, 60), [write]);
  const update = useCallback((props: Record<string, any>) => {
    const cur = windows.get(spec.id);
    if (cur) windows.set(spec.id, { ...cur, props: { ...cur.props, ...props } });
  }, [spec.id]);
  const front = () => {
    if (!locked) {
      const max = Math.max(0, ...[...windows.values()].filter((w) => w.canvasId === spec.canvasId).map((w) => w.z));
      if (spec.z < max) write({ z: max + 1 });
    }
    awareness.setLocalStateField("focus", { windowId: spec.id, typing: false });
  };
  if (!def) return null;
  const Body = def.component;
  const pos = live ?? { x: spec.x, y: spec.y, w: spec.w, h: spec.h };
  const page = windowPage(spec);

  return (
    <Rnd
      position={{ x: pos.x, y: pos.y }}
      size={{ width: pos.w, height: pos.h }}
      scale={scale}
      minWidth={GRID * 13}
      minHeight={GRID * 7}
      dragGrid={[GRID, GRID]}
      resizeGrid={[GRID, GRID]}
      disableDragging={locked}
      enableResizing={!locked}
      dragHandleClassName="wb-drag"
      style={{ zIndex: spec.z }}
      onMouseDown={front}
      onDragStart={() => onInteract(true)}
      onDrag={(_e, d) => {
        setLive({ ...pos, x: d.x, y: d.y });
        writeThrottled({ x: d.x, y: d.y });
      }}
      onDragStop={(_e, d) => {
        writeThrottled.cancel();
        onInteract(false);
        setLive(null);
        write({ x: snap(d.x), y: snap(d.y) });
      }}
      onResizeStart={() => onInteract(true)}
      onResize={(_e, _dir, ref, _delta, p) => {
        const next = { x: p.x, y: p.y, w: ref.offsetWidth, h: ref.offsetHeight };
        setLive(next);
        writeThrottled(next);
      }}
      onResizeStop={(_e, _dir, ref, _delta, p) => {
        writeThrottled.cancel();
        onInteract(false);
        setLive(null);
        write({ x: snap(p.x), y: snap(p.y), w: snap(ref.offsetWidth), h: snap(ref.offsetHeight) });
      }}
    >
      {viewers.length > 0 && (
        // Like a cell someone is in on a shared sheet: a name tag per person above the corner.
        <div className="pointer-events-none absolute -top-[22px] right-2 z-10 flex gap-1" data-testid="window-presence">
          {viewers.map((v) => (
            <span key={v.user.email} className={cn("flex h-5 items-center gap-1 rounded-t-md px-1.5 text-[10px] font-medium text-white shadow-sm", v.focus?.typing && "animate-pulse")}
              style={{ background: v.user.color }} title={`${v.user.name}${v.focus?.typing ? " is typing here" : " is in this window"}`} data-testid="window-presence-tag">
              {v.user.name}{v.user.role === "viewer" ? " (watching)" : v.focus?.typing ? " · typing" : ""}
            </span>
          ))}
        </div>
      )}
      <section data-window-id={spec.id} data-window-type={spec.type} className="flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-md"
        style={viewers.length ? { boxShadow: viewers.map((v, i) => `0 0 0 ${2 * (i + 1)}px ${v.user.color}`).join(", ") } : undefined}
        data-focused-by={viewers.map((v) => v.user.email).join(" ") || undefined}>
        <header className={cn("wb-drag flex h-8 shrink-0 items-center gap-2 border-b bg-muted/60 px-2", !locked && "cursor-grab active:cursor-grabbing")}>
          <def.icon className="size-3.5 shrink-0 text-muted-foreground" />
          {renaming ? (
            <Input
              autoFocus
              defaultValue={windowTitle(spec)}
              className="h-6 max-w-64 px-1.5 text-xs"
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                updateWindow(spec.id, { title: e.target.value.trim() || undefined });
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(false);
              }}
              data-testid="window-rename"
            />
          ) : (
            <span className="truncate text-xs font-medium" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{windowTitle(spec)}</span>
          )}
          {spec.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="shrink-0 text-muted-foreground hover:text-foreground" onMouseDown={(e) => e.stopPropagation()} aria-label="About this window" data-testid="window-info">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 whitespace-pre-wrap">{spec.description}</TooltipContent>
            </Tooltip>
          )}
          <span className="ml-auto" />
          {page && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6" asChild onMouseDown={(e) => e.stopPropagation()}>
                  <Link to={page} aria-label="Open page" data-testid="window-open-page"><ArrowUpRight className="size-3.5" /></Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open page</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" onMouseDown={(e) => e.stopPropagation()} aria-label="Window options">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onMouseDown={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil className="size-4" /> Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(true)} data-testid="window-edit"><Info className="size-4" /> Name and description…</DropdownMenuItem>
              {def.menu && (
                <>
                  <DropdownMenuSeparator />
                  {def.menu.map((m) => <DropdownMenuItem key={m.action} onSelect={() => def.onMenu?.(spec, m.action)} data-testid={m.testid}>{m.label}</DropdownMenuItem>)}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={locked} onSelect={() => closeWindow(spec)} data-testid="window-close">
                <X className="size-4" /> Close window{locked ? " (unlock first)" : ""}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <WindowSettingsDialog spec={spec} open={editing} onOpenChange={setEditing} />
        <div className="min-h-0 flex-1" data-window-body
          onPointerEnter={() => awareness.setLocalStateField("hover", spec.id)}
          onPointerLeave={() => awareness.getLocalState()?.hover === spec.id && awareness.setLocalStateField("hover", null)}>
          <Body spec={spec} update={update} />
        </div>
      </section>
    </Rnd>
  );
}
