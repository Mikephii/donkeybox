import { useCan } from "@/app/context";
import { MoreHorizontal, Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api, type Run } from "@/lib/api";
import { ago, duration, useApi, useNow } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import { StatusDot, statusLabel } from "@/app/StatusDot";
import { StartRunDialog } from "./StartRunDialog";
import type { WindowProps } from "./registry";
import { Num } from "@/components/signature";

export function RunsWindow({ spec, update }: WindowProps) {
  const canRun = useCan("member");
  const live = !!spec.props.live;
  const { data } = useApi<Run[]>(`/runs?limit=200${live ? "&live=1" : ""}`, ["runs"], 10_000);
  const pane = useSidePane();
  const now = useNow(1000);
  const cleanup = async () => {
    const r = await api<{ deleted: number[] }>("/runs/cleanup", { body: { hours: 0 } });
    toast(`Deleted ${r.deleted.length} finished run session(s)`);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <div className="flex rounded-md border p-0.5">
          {[false, true].map((v) => (
            <button key={String(v)} className={cn("rounded px-2 py-0.5", v === live ? "bg-secondary font-medium" : "text-muted-foreground")} onClick={() => update({ live: v })}>
              {v ? "Live" : "All"}
            </button>
          ))}
        </div>
        <StartRunDialog>
          <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" disabled={!canRun} data-testid="start-run"><Play className="size-3.5" /> Start run</Button>
        </StartRunDialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7" aria-label="More"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={cleanup}>Delete sessions of finished runs</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No runs yet.</p>}
        {(data ?? []).map((r) => (
          <button key={r.id} onClick={() => pane.open("run", r.id)} data-testid={`run-${r.id}`}
            className={cn("flex w-full items-start gap-2 border-b px-3 py-1.5 text-left hover:bg-muted/50", pane.raw === `run:${r.id}` && "bg-muted")}>
            <StatusDot status={r.status} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">#{r.id}</span>
                <span className="truncate text-sm">{r.title}</span>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                because {r.trigger_summary ?? (r.parent_run_id ? `run #${r.parent_run_id} continued` : r.actor ? `${r.actor} started it` : "manual")}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
              <Num size="xs" tone="inherit">
                {["queued", "starting", "working", "blocked"].includes(r.status) ? duration(r.started_at ?? r.created_at, null, now) : `${ago(r.ended_at ?? r.created_at, now)} ago`}
                {r.cost_usd != null && ` · $${r.cost_usd.toFixed(3)}`}
              </Num>
              <span className="flex items-center gap-1">
                {r.mode === "print" && <Badge variant="outline" className="h-4 px-1 text-[10px]">print</Badge>}
                {(r.status === "blocked" || (r.open_requests ?? 0) > 0) && <Badge variant="warning" className="h-4 px-1 text-[10px]">{statusLabel("blocked")}</Badge>}
                {r.status !== "blocked" && <span>{r.status}</span>}
              </span>
            </div>
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}
