import { ShellHint } from "@/components/ShellHint";
import { useCan } from "@/app/context";
import { LimitsBar } from "@/app/StatusBanners";
import { useState } from "react";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ErrorList, PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { api, ApiError, type ServiceStatus } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { StatusDot } from "@/app/StatusDot";
import { ServicePane } from "@/pane/ServicePane";
import { restartService } from "@/windows/ServicesWindow";
import { useUrlState } from "./common";

export function ServicesPage() {
  const isAdmin = useCan("admin");
  const u = useUrlState();
  const { data, reload } = useApi<ServiceStatus[]>("/services", ["services"], 4000);
  const now = useNow(5000);
  const selected = u.get("s") || data?.[0]?.id;
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Services" description="The processes behind the workbench, all run by its supervisor: on a laptop and in the container image alike." subject="page:/services">
        <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(!editing)}>{editing ? "Close editor" : "Edit services"}</Button>
      </PageHeader>
      <ShellHint bar>Add your own services under <code>services</code> in the workspace's <code>config.json</code>, or just run things in a terminal; terminals keep running when you close their window.</ShellHint>
      <LimitsBar />
      {editing && <ServicesEditor onSaved={() => (setEditing(false), reload())} />}
      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-80 shrink-0 border-r">
          {(data ?? []).map((s) => (
            <div key={s.id} className={cn("flex items-center gap-2 border-b px-4 py-2", s.id === selected ? "bg-secondary" : "hover:bg-muted/50")} data-testid={`service-${s.id}`}>
              <StatusDot status={s.state} />
              <button className="min-w-0 flex-1 text-left" onClick={() => u.set({ s: s.id })}>
                <div className="truncate text-sm">{s.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">{s.state}{s.pid ? ` · pid ${s.pid}` : ""}{s.since ? ` · ${ago(s.since, now)}` : ""}{s.restarts ? ` · ${s.restarts} restarts` : ""}</div>
              </button>
              <Button size="icon" variant="ghost" className="size-7" disabled={!s.canRestart || !isAdmin} onClick={() => restartService(s).then(() => setTimeout(reload, 1500))} aria-label={`Restart ${s.title}`}><RotateCw className="size-3.5" /></Button>
            </div>
          ))}
        </ScrollArea>
        <div className="min-w-0 flex-1">{selected && <ServicePane id={selected} key={selected} />}</div>
      </div>
    </div>
  );
}

function ServicesEditor({ onSaved }: { onSaved: () => void }) {
  const { data } = useApi<{ raw: { services: unknown[] } }>("/config", []);
  const [text, setText] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const value = text ?? (data ? JSON.stringify(data.raw.services, null, 2) : "");
  const save = async () => {
    try {
      await api("/config/services", { method: "PUT", body: { value: JSON.parse(value) } });
      toast.success("Services saved");
      onSaved();
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    }
  };
  return (
    <div className="grid gap-2 border-b p-4">
      <p className="text-xs text-muted-foreground">Each service: <code>id</code>, <code>title</code>, and either <code>run</code> (a command the supervisor starts and restarts, with <code>cwd</code> relative to the workspace) or <code>probe</code> (a port to watch for something running elsewhere).</p>
      <Textarea value={value} onChange={(e) => setText(e.target.value)} className="h-64 font-mono text-xs" spellCheck={false} />
      <ErrorList errors={errors} />
      <Button size="sm" className="w-fit" onClick={save}>Save services</Button>
    </div>
  );
}
