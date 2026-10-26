import { useCan } from "@/app/context";
import { RotateCw, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type ServiceStatus } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import { addWindow } from "@/app/AddWindowMenu";
import { StatusDot } from "@/app/StatusDot";
import type { WindowProps } from "./registry";

export async function restartService(s: ServiceStatus) {
  try {
    await api(`/services/${s.id}/restart`, { body: {} });
    toast.success(`Restarting ${s.title}`);
  } catch (e) {
    // Restarting the app itself can drop this very request; that is expected.
    if (s.id === "app") toast(`Restarting ${s.title}…`);
    else toast.error((e as Error).message);
  }
}

export function ServicesWindow({ spec }: WindowProps) {
  const isAdmin = useCan("admin");
  const { data, reload } = useApi<ServiceStatus[]>("/services", ["services"], 4000);
  const pane = useSidePane();
  const now = useNow(5000);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span className="text-muted-foreground">{data?.filter((s) => ["running", "up"].includes(s.state)).length ?? 0}/{data?.length ?? 0} up</span>
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={() => addWindow(spec.canvasId, "terminal", { session: "services" })}>
          <SquareTerminal className="size-3.5" /> Services terminal
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {(data ?? []).map((s) => (
          <div key={s.id} className="flex items-center gap-2 border-b px-3 py-1.5" data-testid={`service-${s.id}`}>
            <StatusDot status={s.state} />
            <button className="min-w-0 flex-1 text-left" onClick={() => pane.open("service", s.id)}>
              <div className="truncate text-sm">{s.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {s.state}{s.pid ? ` · pid ${s.pid}` : ""}{s.since ? ` · ${ago(s.since, now)}` : ""}{s.restarts ? ` · ${s.restarts} restarts` : ""}{s.unit ? ` · ${s.unit}` : ""}{s.detail && !s.canRestart ? ` · ${s.detail}` : ""}
              </div>
            </button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={!s.canRestart || busy === s.id || !isAdmin} data-testid={`restart-${s.id}`}
              onClick={async () => {
                setBusy(s.id);
                await restartService(s);
                setTimeout(() => (setBusy(null), reload()), 1500);
              }}>
              <RotateCw className="size-3.5" /> Restart
            </Button>
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
