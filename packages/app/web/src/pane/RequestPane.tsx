import { Link, useNavigate } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PresenceDots } from "@/components/PresenceDots";
import type { Req } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import { Markdown } from "@/app/Markdown";
import { StatusDot } from "@/app/StatusDot";
import { ActionBar } from "@/windows/ActionBar";
import { modeLabel } from "@/windows/RequestsWindow";
import { Num } from "@/components/signature";

export function RequestPane({ id }: { id: number }) {
  return <RequestDetail id={id} layout="pane" />;
}

export function RequestDetail({ id, layout }: { id: number; layout: "pane" | "page" }) {
  const { data: r, error, reload } = useApi<Req>(`/requests/${id}`, ["requests"]);
  const pane = useSidePane();
  const navigate = useNavigate();
  if (error) return <div className="p-4 text-sm text-status-critical-ink">{error}</div>;
  if (!r) return <div className="p-4 text-sm text-muted-foreground">Loading request #{id}…</div>;
  const openRun = (rid: number) => (layout === "page" ? navigate(`/runs/${rid}`) : pane.open("run", rid));
  return (
    <ScrollArea className="h-full">
      <div className={layout === "page" ? "mx-auto max-w-3xl space-y-3 p-6" : "space-y-3 p-4 pr-12"} data-testid={`request-${layout}-${id}`}>
        <div className="flex items-center gap-2">
          <StatusDot status={r.status} />
          <span className="text-xs text-muted-foreground">#{r.id}</span>
          <h2 className={layout === "page" ? "text-lg font-semibold" : "text-sm font-semibold"}>{r.title}</h2>
          {layout === "page" && <div className="ml-auto"><PresenceDots subject={`request:${id}`} /></div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Link to={`/workflows/${r.group_id}`}><Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{r.group_id}</Badge></Link>
          <Badge variant={r.mode === "guard" ? "destructive" : "outline"} className="h-4 px-1.5 text-[10px]">{modeLabel[r.mode]}</Badge>
          <Num size="sm" tone="inherit">{new Date(r.created_at).toLocaleString()}</Num>
          {r.origin_run_id && <button className="underline" onClick={() => openRun(r.origin_run_id!)}>raised by run #{r.origin_run_id}</button>}
          {layout === "pane" && <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 text-[11px]" asChild><Link to={`/requests/${id}`} data-testid="open-full-page"><ArrowUpRight className="size-3" /> Open full page</Link></Button>}
        </div>
        {r.body && <Markdown>{r.body}</Markdown>}
        <ActionBar req={r} onDone={reload} />
        {r.answer && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs" data-testid="request-answer">
            <div><span className="font-medium">{r.answer.actor}</span> chose <span className="font-medium">{r.actions.find((a) => a.id === r.answer!.action_id)?.label ?? r.answer.action_id}</span> at {new Date(r.answer.at).toLocaleString()}</div>
            {Object.keys(r.answer.input ?? {}).length > 0 && <pre className="mt-1 font-mono text-[11px]">{JSON.stringify(r.answer.input, null, 2)}</pre>}
            {r.answer.prompt && <div className="mt-1 text-muted-foreground">Sent to the agent: {r.answer.prompt}</div>}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
