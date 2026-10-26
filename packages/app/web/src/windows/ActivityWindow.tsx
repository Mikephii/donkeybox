import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Ev } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import type { WindowProps } from "./registry";

export function ActivityWindow(_: WindowProps) {
  const { data } = useApi<Ev[]>("/events?limit=150", ["events"]);
  const pane = useSidePane();
  const now = useNow(15_000);
  return (
    <ScrollArea className="h-full">
      {(data ?? []).map((e) => (
        <div key={e.id} className="flex items-center gap-2 border-b px-3 py-1 text-xs">
          <span className="w-8 shrink-0 text-right text-muted-foreground">{ago(e.at, now)}</span>
          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{e.source}</Badge>
          <span className="truncate" title={e.type}>{e.summary ?? e.type}</span>
          {e.run_id && <button className="ml-auto shrink-0 text-muted-foreground hover:underline" onClick={() => pane.open("run", e.run_id!)}>run #{e.run_id}</button>}
        </div>
      ))}
    </ScrollArea>
  );
}
