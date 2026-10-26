import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowUpRight, CheckSquare, ExternalLink, Play, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PresenceDots } from "@/components/PresenceDots";
import { api, type Ev, type Req, type Run } from "@/lib/api";
import { duration, useApi, useNow } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import { Markdown } from "@/app/Markdown";
import { StatusDot, statusLabel } from "@/app/StatusDot";
import { TerminalFrame } from "@/windows/TerminalFrame";
import { Gate } from "@/components/Gate";
import { ActionBar } from "@/windows/ActionBar";
import { Timeline } from "./Timeline";
import { Num } from "@/components/signature";

interface Detail { run: Run; trigger: Ev | null; timeline: Ev[]; requests: Req[]; children: { id: number; title: string; status: string }[]; parent: Run | null; alive: boolean }

/** Quick peek from a canvas window. */
export function RunPane({ id }: { id: number }) {
  return <RunDetail id={id} layout="pane" />;
}

/**
 * One run. "pane": stacked, with a link to the full page. "page": header across the top, then the
 * timeline and the live terminal side by side at full size.
 */
export function RunDetail({ id, layout }: { id: number; layout: "pane" | "page" }) {
  const { data, error, reload } = useApi<Detail>(`/runs/${id}`, ["runs", "events", "requests"], 5000);
  const pane = useSidePane();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [steer, setSteer] = useState("");
  if (error) return <div className="p-4 text-sm text-status-critical-ink">{error}</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Loading run #{id}…</div>;
  const { run, trigger, timeline, requests, children, parent, alive } = data;
  const active = ["queued", "starting", "working", "blocked"].includes(run.status);
  const hasTerminal = run.mode === "interactive" && run.zellij_session && !run.session_deleted;
  const openRun = (rid: number) => (layout === "page" ? navigate(`/runs/${rid}`) : pane.open("run", rid));
  const openReq = (rid: number) => (layout === "page" ? navigate(`/requests/${rid}`) : pane.open("request", rid));

  const act = async (path: string, body: unknown, ok: string) => {
    try {
      await api(path, { body });
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const sendSteer = async () => {
    if (!steer.trim()) return;
    await act(`/runs/${id}/steer`, { text: steer }, "Sent to the agent");
    setSteer("");
  };
  const openReqs = requests.filter((r) => r.status === "open");

  const header = (
    <div className={layout === "pane" ? "space-y-1.5 border-b p-3 pr-12" : "space-y-1.5 border-b px-5 py-3"}>
      <div className="flex items-center gap-2">
        <StatusDot status={run.status} />
        <span className="text-xs text-muted-foreground">#{run.id}</span>
        <h2 className={layout === "page" ? "truncate text-base font-semibold" : "truncate text-sm font-semibold"}>{run.title}</h2>
        {layout === "page" && (
          <div className="ml-auto">
            <PresenceDots subject={`run:${id}`} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Link to={`/workflows/${run.group_id}`}><Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{run.group_id}</Badge></Link>
        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{run.mode}</Badge>
        <span data-testid="run-status">{statusLabel(run.status)}</span>
        <span>· <Num size="sm" tone="inherit">{duration(run.started_at ?? run.created_at, run.ended_at, now)}</Num></span>
        {run.cost_usd != null && <span>· ${run.cost_usd.toFixed(4)}</span>}
        {run.model && <span>· {run.model}</span>}
        {run.workdir && <span title={run.workdir} data-testid="run-workdir">· in <code>{run.workdir}</code></span>}
        {run.goal && <span title={run.goal}>· goal retries {run.goal_iterations}</span>}
        <span>· started <Num size="sm" tone="inherit">{new Date(run.created_at).toLocaleString()}</Num></span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        because {trigger?.summary ?? (parent ? "" : run.actor ? `${run.actor} started it` : "manual start")}
        {parent && <> continuing <button className="underline" onClick={() => openRun(parent.id)}>run #{parent.id}</button></>}
        {children.length > 0 && <> · continued in {children.map((c) => <button key={c.id} className="ml-1 underline" onClick={() => openRun(c.id)}>#{c.id}</button>)}</>}
      </div>
      {run.error && <div className="text-[11px] text-status-critical-ink">{run.error}</div>}
      <Gate need="member"><div className="flex flex-wrap gap-1.5 pt-1">
        {active && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => act(`/runs/${id}/stop`, {}, "Stopped")}><Square className="size-3" /> Stop</Button>}
        {run.status === "interrupted" && run.mode === "interactive" && (
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => act(`/runs/${id}/resume`, {}, "Resuming in the same session")} data-testid="run-resume"><Play className="size-3" /> Resume</Button>
        )}
        {(active || run.status === "idle") && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => act(`/runs/${id}/stop`, { final: "done" }, "Marked done")}><CheckSquare className="size-3" /> Finish</Button>}
        {hasTerminal && <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" asChild><a href={`/term/${run.zellij_session}`} target="_blank" rel="noreferrer"><ExternalLink className="size-3" /> Terminal in a tab</a></Button>}
        {layout === "pane" && <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" asChild><Link to={`/runs/${id}`} data-testid="open-full-page"><ArrowUpRight className="size-3" /> Open full page</Link></Button>}
      </div></Gate>
      {openReqs.map((r) => (
        <div key={r.id} className="rounded-md border border-status-warning/50 bg-status-warning-subtle p-2">
          <button className="mb-1.5 text-left text-xs font-medium hover:underline" onClick={() => openReq(r.id)}>Waiting on: {r.title}</button>
          <ActionBar req={r} onDone={reload} />
        </div>
      ))}
    </div>
  );

  const record = (
    <ScrollArea className="h-full">
      <details className="border-b px-3 py-1.5 text-xs" open={layout === "page"}>
        <summary className="cursor-pointer text-muted-foreground">Prompt</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{run.prompt}</pre>
      </details>
      <Timeline events={timeline} />
      {layout === "page" && requests.length > 0 && (
        <div className="border-t px-3 py-2 text-xs">
          <div className="mb-1 font-medium">Requests</div>
          {requests.map((r) => (
            <button key={r.id} className="flex w-full items-center gap-2 py-0.5 text-left hover:underline" onClick={() => openReq(r.id)}>
              <StatusDot status={r.status} /> #{r.id} {r.title}
              {r.answer && <span className="text-muted-foreground">· {r.answer.action_id} by {r.answer.actor}</span>}
            </button>
          ))}
        </div>
      )}
      {run.result && (
        <div className="border-t px-3 py-2 text-xs">
          <div className="mb-1 font-medium">Result</div>
          <Markdown>{run.result}</Markdown>
        </div>
      )}
    </ScrollArea>
  );

  const terminal = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {alive ? <TerminalFrame session={run.zellij_session!} /> : <div className="p-4 text-xs text-muted-foreground">The session for this run has ended. The timeline is the record.</div>}
      </div>
      {alive && (
        <Gate need="member"><form className="flex gap-2 border-t p-2" onSubmit={(e) => (e.preventDefault(), sendSteer())}>
          <Input value={steer} onChange={(e) => setSteer(e.target.value)} placeholder="Steer: message the agent without clicking into the terminal" className="h-8 text-xs" data-testid="steer-input" />
          <Button size="sm" className="h-8 gap-1" type="submit" disabled={!steer.trim()} data-testid="steer-send"><Send className="size-3.5" /> Send</Button>
        </form></Gate>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={`run-${layout}-${id}`}>
      {header}
      {hasTerminal ? (
        <ResizablePanelGroup orientation={layout === "page" ? "horizontal" : "vertical"} className="min-h-0 flex-1">
          <ResizablePanel id="record" defaultSize={layout === "page" ? "38" : "40"} minSize="15">{record}</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="terminal" defaultSize={layout === "page" ? "62" : "60"} minSize="20">{terminal}</ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 flex-1">{record}</div>
      )}
    </div>
  );
}
