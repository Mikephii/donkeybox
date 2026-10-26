import { LimitsBar } from "@/app/StatusBanners";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Play, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/PageHeader";
import { Gate } from "@/components/Gate";
import type { GroupInfo, Run } from "@/lib/api";
import { duration, useApi, useNow } from "@/lib/hooks";
import { StatusDot } from "@/app/StatusDot";
import { RunDetail } from "@/pane/RunPane";
import { StartRunDialog } from "@/windows/StartRunDialog";
import { MultiFilter, Pager, STATUS_OPTIONS, TRIGGER_OPTIONS, useUrlState } from "./common";
import { Num } from "@/components/signature";

interface Search { rows: (Run & { trigger_source?: string })[]; total: number; cost: number; page: number; pages: number }

export function RunsPage() {
  const u = useUrlState();
  const [q, setQ] = useState(u.get("q"));
  useEffect(() => {
    const t = setTimeout(() => q !== u.get("q") && u.set({ q }), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams(u.params);
  qs.delete("pane");
  const { data } = useApi<Search>(`/runs/search?${qs}`, ["runs"], 10_000);
  const { data: groups } = useApi<GroupInfo[]>("/groups", ["config"]);
  const now = useNow(5000);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Runs" description="Every agent run: what started it, what it did, what it cost." subject="page:/runs">
        <Gate need="member">
          <StartRunDialog>
            <Button size="sm" className="h-8 gap-1"><Play className="size-3.5" /> Start run</Button>
          </StartRunDialog>
        </Gate>
      </PageHeader>
      <LimitsBar />
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, prompt or #id" className="h-8 w-64 pl-8 text-xs" data-testid="runs-search" />
        </div>
        <MultiFilter label="Workflow" options={(groups ?? []).map((g) => ({ value: g.id, label: g.title }))} value={u.getList("group")} onChange={(v) => u.set({ group: v })} testid="filter-group" />
        <MultiFilter label="Status" options={STATUS_OPTIONS} value={u.getList("status")} onChange={(v) => u.set({ status: v })} testid="filter-status" />
        <MultiFilter label="Trigger" options={TRIGGER_OPTIONS} value={u.getList("trigger")} onChange={(v) => u.set({ trigger: v })} testid="filter-trigger" />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">From <Input type="date" value={u.get("from")} onChange={(e) => u.set({ from: e.target.value })} className="h-8 w-36 text-xs" data-testid="filter-from" /></label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">To <Input type="date" value={u.get("to")} onChange={(e) => u.set({ to: e.target.value })} className="h-8 w-36 text-xs" data-testid="filter-to" /></label>
        <div className="ml-auto text-xs text-muted-foreground" data-testid="runs-totals">
          {data ? <><span className="font-medium text-foreground">{data.total}</span> runs · <span className="font-medium text-foreground">${data.cost.toFixed(2)}</span> total</> : "…"}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full text-sm" data-testid="runs-table">
          <thead className="sticky top-0 z-10 bg-background text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b">
              <th className="w-8 py-2 pl-5"></th>
              <th className="py-2">Run</th>
              <th className="py-2">Workflow</th>
              <th className="py-2">Because</th>
              <th className="py-2">Started</th>
              <th className="py-2">Took</th>
              <th className="py-2 pr-5 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/40" data-testid={`runs-row-${r.id}`}>
                <td className="py-2 pl-5"><StatusDot status={r.status} /></td>
                <td className="max-w-md py-2">
                  <Link to={`/runs/${r.id}`} className="flex items-center gap-1.5 hover:underline">
                    <span className="text-xs text-muted-foreground">#{r.id}</span>
                    <span className="truncate">{r.title}</span>
                    {r.mode === "print" && <Badge variant="outline" className="h-4 px-1 text-[10px]">print</Badge>}
                    {(r.open_requests ?? 0) > 0 && <Badge variant="warning" className="h-4 px-1 text-[10px]">waiting</Badge>}
                  </Link>
                </td>
                <td className="py-2 text-xs"><Link to={`/workflows/${r.group_id}`} className="hover:underline">{r.group_id}</Link></td>
                <td className="max-w-xs truncate py-2 text-xs text-muted-foreground">{r.trigger_summary ?? (r.parent_run_id ? `continued run #${r.parent_run_id}` : r.actor ?? "")}</td>
                <td className="py-2"><Num size="sm" tone="muted">{new Date(r.created_at).toLocaleString()}</Num></td>
                <td className="py-2"><Num size="sm" tone="muted">{duration(r.started_at ?? r.created_at, r.ended_at, now)}</Num></td>
                <td className="py-2 pr-5 text-right text-xs tabular-nums">{r.cost_usd != null ? `$${r.cost_usd.toFixed(3)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">No runs match these filters.</p>}
      </ScrollArea>
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => u.set({ page: p }, { resetPage: false })} />}
    </div>
  );
}

export function RunPage() {
  const { id } = useParams();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center border-b px-5 text-xs text-muted-foreground">
        <Link to="/runs" className="hover:underline">Runs</Link>
        <span className="mx-1.5">/</span>
        <span>#{id}</span>
      </div>
      <div className="min-h-0 flex-1">
        <RunDetail id={Number(id)} layout="page" key={id} />
      </div>
    </div>
  );
}
