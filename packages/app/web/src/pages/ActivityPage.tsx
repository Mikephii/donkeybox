import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { api, type Ev } from "@/lib/api";
import { useApi, useSignal } from "@/lib/hooks";
import { useUrlState } from "./common";
import { Num } from "@/components/signature";

const ANY = "__any";

export function ActivityPage() {
  const u = useUrlState();
  const { data: facets } = useApi<{ sources: string[]; actors: string[] }>("/events/facets", ["events"], 60_000);
  const [type, setType] = useState(u.get("type"));
  const [run, setRun] = useState(u.get("run"));
  const [more, setMore] = useState<Ev[]>([]);
  const tick = useSignal(["events"]);
  useEffect(() => {
    const t = setTimeout(() => (type !== u.get("type") || run !== u.get("run")) && u.set({ type, run }), 300);
    return () => clearTimeout(t);
  }, [type, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams();
  for (const k of ["type", "source", "actor", "run", "from", "to", "hooks"]) if (u.get(k)) qs.set(k, u.get(k));
  qs.set("limit", "100");
  const { data } = useApi<Ev[]>(`/events?${qs}`, ["events"]);
  useEffect(() => setMore([]), [qs.toString(), tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...(data ?? []), ...more];
  const loadMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    const q2 = new URLSearchParams(qs);
    q2.set("before", String(last.id));
    setMore([...more, ...(await api<Ev[]>(`/events?${q2}`))]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Activity" description="The audit log: every event, who did it, and what it led to." subject="page:/activity" />
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs">
        <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type, e.g. request.* or github.*" className="h-8 w-56 font-mono text-xs" data-testid="activity-type" />
        <Select value={u.get("source") || ANY} onValueChange={(v) => u.set({ source: v === ANY ? null : v })}>
          <SelectTrigger size="sm" className="w-44 text-xs" data-testid="activity-source"><SelectValue placeholder="Any source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any source</SelectItem>
            <SelectItem value="webhook">Any webhook</SelectItem>
            {(facets?.sources ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={u.get("actor") || ANY} onValueChange={(v) => u.set({ actor: v === ANY ? null : v })}>
          <SelectTrigger size="sm" className="w-48 text-xs" data-testid="activity-actor"><SelectValue placeholder="Anyone" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Anyone</SelectItem>
            {(facets?.actors ?? []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={run} onChange={(e) => setRun(e.target.value.replace(/\D/g, ""))} placeholder="Run #" className="h-8 w-20 text-xs" data-testid="activity-run" />
        <label className="flex items-center gap-1 text-muted-foreground">From <Input type="date" value={u.get("from")} onChange={(e) => u.set({ from: e.target.value })} className="h-8 w-36 text-xs" /></label>
        <label className="flex items-center gap-1 text-muted-foreground">To <Input type="date" value={u.get("to")} onChange={(e) => u.set({ to: e.target.value })} className="h-8 w-36 text-xs" /></label>
        <label className="flex items-center gap-1.5 text-muted-foreground"><Checkbox checked={u.get("hooks") === "1"} onCheckedChange={(c) => u.set({ hooks: c ? "1" : null })} /> Include agent tool calls</label>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div data-testid="activity-list">
          {rows.map((e) => {
            const payload = JSON.parse(e.payload || "{}");
            return (
              <div key={e.id} className="flex items-center gap-3 border-b px-5 py-1.5 text-xs">
                <Num size="sm" tone="muted" className="w-40 shrink-0">{new Date(e.at).toLocaleString()}</Num>
                <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{e.source}</Badge>
                <span className="w-44 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={e.type}>{e.type}</span>
                <span className="min-w-0 flex-1 truncate">{e.summary ?? e.type}</span>
                {e.actor && <span className="shrink-0 text-muted-foreground">{e.actor}</span>}
                {payload.request_id && <Link to={`/requests/${payload.request_id}`} className="shrink-0 text-muted-foreground hover:underline">request #{payload.request_id}</Link>}
                {e.run_id && <Link to={`/runs/${e.run_id}`} className="shrink-0 text-muted-foreground hover:underline">run #{e.run_id}</Link>}
              </div>
            );
          })}
          {rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">Nothing matches these filters.</p>}
          {rows.length >= 100 && <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={loadMore}>Load older</Button></div>}
        </div>
      </ScrollArea>
    </div>
  );
}
