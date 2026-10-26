import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import type { GroupInfo, Req } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { Markdown } from "@/app/Markdown";
import { StatusDot } from "@/app/StatusDot";
import { RequestDetail } from "@/pane/RequestPane";
import { ActionBar, type ActionBarHandle } from "@/windows/ActionBar";
import { modeLabel } from "@/windows/RequestsWindow";
import { MultiFilter, useUrlState } from "./common";
import { Num } from "@/components/signature";

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

export function InboxPage() {
  const u = useUrlState();
  const navigate = useNavigate();
  const tab = u.get("tab") === "answered" ? "answered" : "open";
  const groups = u.getList("group");
  const qs = new URLSearchParams({ status: tab === "open" ? "open" : "answered,closed", limit: "300" });
  if (groups.length) qs.set("group", groups.join(","));
  const { data: reqs, reload } = useApi<Req[]>(`/requests?${qs}`, ["requests"]);
  const { data: groupInfo } = useApi<GroupInfo[]>("/groups", ["requests", "config"]);
  const titles = Object.fromEntries((groupInfo ?? []).map((g) => [g.id, g.title]));
  const now = useNow(15_000);

  const list = useMemo(() => {
    const rows = [...(reqs ?? [])];
    // Group by workflow, keeping each group's newest first.
    if (tab === "open") rows.sort((a, b) => a.group_id.localeCompare(b.group_id) || b.id - a.id);
    return rows;
  }, [reqs, tab]);
  // Keep the cursor's position when the selected request leaves the list (answered), so triage flows down.
  const lastIndex = useRef(0);
  const selectedId = Number(u.get("sel")) || undefined;
  const found = selectedId != null ? list.findIndex((r) => r.id === selectedId) : -1;
  const index = found >= 0 ? found : Math.min(lastIndex.current, Math.max(list.length - 1, 0));
  lastIndex.current = index;
  const selected = list[index];
  const bar = useRef<ActionBarHandle>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const select = (id: number | undefined) => id != null && u.set({ sel: id }, { resetPage: false });

  useEffect(() => {
    if (selected) rowRefs.current.get(selected.id)?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard triage: j/k move, Enter opens, 1-9 press that action, Esc cancels a form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") return bar.current?.cancel();
      if (typing(e.target)) return;
      if (e.key === "j" || e.key === "ArrowDown") (e.preventDefault(), select(list[Math.min(index + 1, list.length - 1)]?.id));
      else if (e.key === "k" || e.key === "ArrowUp") (e.preventDefault(), select(list[Math.max(index - 1, 0)]?.id));
      else if (e.key === "Enter" && selected) (e.preventDefault(), navigate(`/requests/${selected.id}`));
      else if (/^[1-9]$/.test(e.key) && selected && tab === "open") (e.preventDefault(), bar.current?.press(Number(e.key)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Inbox" description="Everything waiting on a person, across every workflow." subject="page:/inbox" />
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs">
        <div className="flex rounded-md border p-0.5">
          {(["open", "answered"] as const).map((t) => (
            <button key={t} className={cn("rounded px-2.5 py-1", t === tab ? "bg-secondary font-medium" : "text-muted-foreground")} onClick={() => u.set({ tab: t === "open" ? null : t, sel: null })} data-testid={`inbox-tab-${t}`}>
              {t === "open" ? "Open" : "Answered"}
            </button>
          ))}
        </div>
        <MultiFilter label="Workflow" options={(groupInfo ?? []).map((g) => ({ value: g.id, label: `${g.title} (${g.open})` }))} value={groups} onChange={(v) => u.set({ group: v, sel: null })} testid="inbox-filter" />
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          <Kbd>j</Kbd><Kbd>k</Kbd> move · <Kbd>1</Kbd>–<Kbd>9</Kbd> act · <Kbd>Enter</Kbd> open · <Kbd>Esc</Kbd> cancel
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-[42%] min-w-80 border-r">
          {list.length === 0 && <p className="p-5 text-sm text-muted-foreground">{tab === "open" ? "Nothing waiting on a person." : "Nothing answered yet."}</p>}
          {list.map((r, i) => {
            const newGroup = tab === "open" && (i === 0 || list[i - 1]!.group_id !== r.group_id) && groups.length !== 1;
            return (
              <div key={r.id}>
                {newGroup && <div className="border-b bg-muted/40 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titles[r.group_id] ?? r.group_id}</div>}
                <button
                  ref={(el) => void (el ? rowRefs.current.set(r.id, el) : rowRefs.current.delete(r.id))}
                  onClick={() => select(r.id)}
                  onDoubleClick={() => navigate(`/requests/${r.id}`)}
                  data-testid={`inbox-row-${r.id}`}
                  data-selected={r.id === selected?.id ? "true" : "false"}
                  className={cn("flex w-full items-start gap-2 border-b px-4 py-2 text-left", r.id === selected?.id ? "bg-secondary" : "hover:bg-muted/50")}
                >
                  <StatusDot status={r.status} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>#{r.id}</span>
                      <Badge variant={r.mode === "guard" ? "destructive" : "secondary"} className="h-4 px-1.5 text-[10px]">{modeLabel[r.mode]}</Badge>
                      {tab === "answered" && <span>{titles[r.group_id] ?? r.group_id}</span>}
                      <span>{ago(r.created_at, now)} ago</span>
                      {r.answer && <span>· {r.actions.find((a) => a.id === r.answer!.action_id)?.label ?? r.answer.action_id} by {r.answer.actor}</span>}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </ScrollArea>
        <div className="min-w-0 flex-1">
          {selected ? (
            <ScrollArea className="h-full">
              <div className="space-y-3 p-5" data-testid="inbox-detail">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">{selected.title}</h2>
                  <Link to={`/requests/${selected.id}`} className="ml-auto text-xs text-muted-foreground hover:underline">Open full page</Link>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Link to={`/workflows/${selected.group_id}`} className="hover:underline">{titles[selected.group_id] ?? selected.group_id}</Link>
                  {selected.origin_run_id && <Link to={`/runs/${selected.origin_run_id}`} className="hover:underline">raised by run #{selected.origin_run_id}</Link>}
                  <Num size="sm" tone="inherit">{new Date(selected.created_at).toLocaleString()}</Num>
                </div>
                {selected.body && <Markdown>{selected.body}</Markdown>}
                <ActionBar req={selected} ref={bar} onDone={reload} showKeys key={selected.id} />
                {selected.answer && (
                  <div className="rounded-md border bg-muted/40 p-3 text-xs">
                    <span className="font-medium">{selected.answer.actor}</span> chose <span className="font-medium">{selected.actions.find((a) => a.id === selected.answer!.action_id)?.label ?? selected.answer.action_id}</span> at {new Date(selected.answer.at).toLocaleString()}
                    {Object.keys(selected.answer.input ?? {}).length > 0 && <pre className="mt-1 font-mono text-[11px]">{JSON.stringify(selected.answer.input, null, 2)}</pre>}
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">Select a request.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RequestPage() {
  const { id } = useParams();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center border-b px-5 text-xs text-muted-foreground">
        <Link to="/inbox" className="hover:underline">Inbox</Link>
        <span className="mx-1.5">/</span>
        <span>#{id}</span>
      </div>
      <div className="min-h-0 flex-1">
        <RequestDetail id={Number(id)} layout="page" key={id} />
      </div>
    </div>
  );
}
