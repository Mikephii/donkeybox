import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useYMap } from "@/lib/hooks";
import { closed } from "@/lib/yjs";
import { restoreWindow } from "./windowActions";
import { newId, windows, type WindowType } from "@/lib/yjs";
import { windowTitle, windowTypes } from "@/windows/registry";
import { snap } from "./arrange";
import { visibleRect } from "@/lib/viewport";

export function addWindow(canvasId: string, type: WindowType, props: Record<string, any> = {}, title?: string) {
  const def = windowTypes[type];
  const mine = [...windows.values()].filter((w) => w.canvasId === canvasId);
  const z = Math.max(0, ...mine.map((w) => w.z)) + 1;
  const offset = (mine.length % 8) * 40;
  const v = visibleRect(canvasId);
  const x = snap(v.left + 40 + offset);
  const y = snap(v.top + 40 + offset);
  const id = newId();
  windows.set(id, { id, canvasId, type, x, y, w: def.w, h: def.h, z, props: { ...def.props, ...props }, title });
  return id;
}

export function AddWindowMenu({ canvasId, locked }: { canvasId: string; locked: boolean }) {
  const gone = [...useYMap(closed).values()].filter((w) => w.canvasId === canvasId).sort((a, b) => b.closedAt - a.closedAt).slice(0, 8);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" data-testid="add-window" disabled={locked} title={locked ? "Unlock the canvas to add windows" : undefined}>
          <LayoutGrid className="size-4" /> Add window
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Add to this canvas</DropdownMenuLabel>
        {(Object.entries(windowTypes) as [WindowType, (typeof windowTypes)[WindowType]][]).filter(([, d]) => !d.hidden).map(([type, d]) => (
          <DropdownMenuItem key={type} onSelect={() => addWindow(canvasId, type)} data-testid={`add-${type}`}>
            <d.icon className="size-4" /> {d.label}
          </DropdownMenuItem>
        ))}
        {gone.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Recently closed</DropdownMenuLabel>
            {gone.map((w) => {
              const Icon = windowTypes[w.type]?.icon;
              return (
                <DropdownMenuItem key={w.id} onSelect={() => restoreWindow(w.id)} data-testid={`restore-${w.id}`}>
                  {Icon && <Icon className="size-4" />} <span className="truncate">{windowTitle(w)}</span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
