import { useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, CircleDot, Flag, Inbox, MessageSquare, Play, Send, StickyNote, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Ev } from "@/lib/api";
import { useSidePane } from "@/app/context";

function icon(type: string) {
  if (type === "hook.PreToolUse") return Wrench;
  if (type === "hook.PostToolUse") return CircleDot;
  if (type === "hook.UserPromptSubmit") return MessageSquare;
  if (type === "hook.Stop") return CheckCircle2;
  if (type.startsWith("request.")) return Inbox;
  if (type === "agent.note") return StickyNote;
  if (type.startsWith("goal.")) return Flag;
  if (type === "run.steered") return Send;
  if (type.startsWith("run.")) return Play;
  return Bot;
}

export function Timeline({ events }: { events: Ev[] }) {
  const end = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const pane = useSidePane();
  const count = events.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return (
    <div className="space-y-px py-1 text-xs" data-testid="timeline">
      {events.map((e) => {
        const Icon = icon(e.type);
        const payload = JSON.parse(e.payload || "{}");
        const muted = e.type === "hook.PostToolUse" || e.type === "hook.SessionStart";
        return (
          <div key={e.id} className="px-3">
            <button className={cn("flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60", muted && "text-muted-foreground")} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <Icon className="mt-0.5 size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 break-words">{e.summary ?? e.type}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
            </button>
            {e.type.startsWith("request.") && payload.request_id && (
              <button className="ml-6 text-[11px] text-link hover:underline" onClick={() => pane.open("request", payload.request_id)}>open request #{payload.request_id}</button>
            )}
            {open === e.id && <pre className="ml-6 mt-1 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify(payload, null, 2)}</pre>}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
