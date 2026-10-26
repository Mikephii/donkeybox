import { cn } from "@/lib/utils";

// A square status mark (the design system's dot, not a circle). Fills are the reserved status
// tokens and are never the only signal: every dot carries its status as a title and sits beside
// a label. Something happening now blinks (the LiveDot cadence, held still under reduced motion).
const LIVE = "animate-[signature-blink_2.2s_steps(2,jump-none)_infinite]";
const styles: Record<string, string> = {
  queued: "bg-muted-foreground/60",
  starting: `bg-status-info ${LIVE}`,
  working: `bg-status-info ${LIVE}`,
  blocked: "bg-status-warning",
  idle: "bg-muted-foreground/60",
  done: "bg-status-good",
  failed: "bg-status-critical",
  stopped: "bg-muted-foreground",
  interrupted: "bg-status-serious",
  running: "bg-status-good",
  up: "bg-status-good",
  down: "bg-status-critical",
  crashed: "bg-status-critical",
  unknown: "bg-muted-foreground/60",
  open: "bg-status-warning",
  answered: "bg-status-good",
  closed: "bg-muted-foreground/60",
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span title={status} className={cn("inline-block size-2 shrink-0 rounded-[2px]", styles[status] ?? "bg-muted-foreground/60", className)} />;
}

export function statusLabel(s: string) {
  return s === "blocked" ? "waiting on a human" : s;
}
