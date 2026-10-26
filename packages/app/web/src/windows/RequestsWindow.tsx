import { useState } from "react";
import { ChevronRight, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GroupInfo, Req } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import { Markdown } from "@/app/Markdown";
import { StatusDot } from "@/app/StatusDot";
import { ActionBar } from "./ActionBar";
import type { WindowProps } from "./registry";

export const modeLabel: Record<string, string> = { blocking: "agent waiting", deferred: "async", guard: "guarded tool" };

export function RequestsWindow({ spec, update }: WindowProps) {
  const groups: string[] = spec.props.groups ?? [];
  const showAll = spec.props.status === "all";
  const qs = new URLSearchParams();
  if (!showAll) qs.set("status", "open");
  if (groups.length) qs.set("group", groups.join(","));
  const { data: reqs, reload } = useApi<Req[]>(`/requests?${qs}`, ["requests"]);
  const { data: groupInfo } = useApi<GroupInfo[]>("/groups", ["requests", "config"]);
  const titles = Object.fromEntries((groupInfo ?? []).map((g) => [g.id, g.title]));

  const byGroup = new Map<string, Req[]>();
  for (const r of reqs ?? []) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r]);

  const toggle = (id: string) => update({ groups: groups.includes(id) ? groups.filter((g) => g !== id) : [...groups, id] });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"><Filter className="size-3.5" />{groups.length ? groups.map((g) => titles[g] ?? g).join(", ") : "All groups"}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Groups</DropdownMenuLabel>
            {(groupInfo ?? []).map((g) => (
              <DropdownMenuCheckboxItem key={g.id} checked={groups.includes(g.id)} onCheckedChange={() => toggle(g.id)} onSelect={(e) => e.preventDefault()}>
                {g.title} <span className="ml-auto text-muted-foreground">{g.open}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={groups.length === 0} onCheckedChange={() => update({ groups: [] })}>All groups</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex rounded-md border p-0.5">
          {(["open", "all"] as const).map((s) => (
            <button key={s} className={cn("rounded px-2 py-0.5", (s === "all") === showAll ? "bg-secondary font-medium" : "text-muted-foreground")} onClick={() => update({ status: s })}>
              {s === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {reqs && reqs.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing waiting on a human.</p>}
        {[...byGroup.entries()].map(([g, items]) => (
          <div key={g}>
            {groups.length !== 1 && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {titles[g] ?? g}<span className="font-normal">{items.filter((i) => i.status === "open").length}</span>
              </div>
            )}
            {items.map((r) => <RequestItem key={r.id} req={r} onChange={reload} />)}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}

function RequestItem({ req, onChange }: { req: Req; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const pane = useSidePane();
  const now = useNow(15_000);
  return (
    <div className="border-b px-3 py-2" data-testid={`request-${req.id}`}>
      <div className="flex items-start gap-2">
        <button className="mt-0.5 text-muted-foreground" onClick={() => setOpen(!open)} aria-label="Expand">
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={req.status} />
            <button className="truncate text-left text-sm font-medium hover:underline" onClick={() => pane.open("request", req.id)}>{req.title}</button>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>#{req.id}</span>
            <Badge variant={req.mode === "guard" ? "destructive" : "secondary"} className="h-4 px-1.5 text-[10px]">{modeLabel[req.mode]}</Badge>
            {req.origin_run_id && <button className="hover:underline" onClick={() => pane.open("run", req.origin_run_id!)}>from run #{req.origin_run_id}</button>}
            <span>{ago(req.created_at, now)} ago</span>
            {req.answer && <span>· {req.answer.action_id} by {req.answer.actor}</span>}
          </div>
        </div>
      </div>
      {open && req.body && <div className="mt-2 pl-6"><Markdown>{req.body}</Markdown></div>}
      {req.status === "open" && <div className="mt-2 pl-6"><ActionBar req={req} onDone={onChange} /></div>}
    </div>
  );
}
