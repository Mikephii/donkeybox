import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ServiceStatus } from "@/lib/api";
import { identityOverride } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { StatusDot } from "@/app/StatusDot";
import { restartService } from "@/windows/ServicesWindow";

export function ServicePane({ id }: { id: string }) {
  const { data } = useApi<ServiceStatus[]>("/services", ["services"], 4000);
  const s = data?.find((x) => x.id === id);
  const [logs, setLogs] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const as = identityOverride();
      const r = await fetch(`/api/services/${id}/logs?lines=300`, { headers: as ? { "x-wb-as": as } : {} }).catch(() => null);
      if (r && alive) setLogs(await r.text());
    };
    load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  useEffect(() => {
    const el = pre.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [logs]);
  return (
    <div className="flex h-full flex-col" data-testid={`service-pane-${id}`}>
      <div className="flex items-center gap-2 border-b p-3 pr-12">
        {s && <StatusDot status={s.state} />}
        <h2 className="text-sm font-semibold">{s?.title ?? id}</h2>
        <span className="text-xs text-muted-foreground">{s?.state}{s?.pid ? ` · pid ${s.pid}` : ""}</span>
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" disabled={!s?.canRestart} onClick={() => s && restartService(s)}>
          <RotateCw className="size-3.5" /> Restart
        </Button>
      </div>
      <pre ref={pre} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-muted/30 p-3 font-mono text-[11px] leading-snug">{logs || "No logs yet."}</pre>
    </div>
  );
}
