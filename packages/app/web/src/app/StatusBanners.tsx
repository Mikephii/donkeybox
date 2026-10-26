import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, GitBranch, Moon, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export interface Status {
  configErrors: string[] | null;
  configPath: string;
  workspace?: { git: boolean; diverged: boolean; uncommitted: boolean; lastError: string | null; remote: string | null; branch: string | null };
  box?: { id?: string; name: string };
  coldStart?: { at: string; sessions: string[] } | null;
  limits?: Limits;
  dataMount?: { expected: boolean; mounted: boolean };
  skillsDir?: string;
  drain?: { draining: boolean; since: string | null; by: string | null; deadline: string | null; liveRuns: number; queuedRuns: number; ready: boolean };
  editor?: { on: boolean; installed: boolean; workspaceFile: string; workspaceDir: string; homeDir: string };
}

export interface Limits {
  maxConcurrentRuns: number; maxRunSessionHours: number; diskWarnPercent: number; diskStopPercent: number; maxTerminals: number;
  activeRuns: number; queuedRuns: number; waiting: string | null; terminals: number; diskPercent: number | null; diskWarn: boolean; diskStop: boolean;
}

/** Where the box stands against its limits (Settings › Limits), shown on the Runs and Services pages. */
export function LimitsBar() {
  const l = useStatus().data?.limits;
  if (!l) return null;
  const item = (label: string, value: string, warn = false) => (
    <span className={warn ? "text-status-warning-ink" : ""}><span className="text-muted-foreground">{label}</span> {value}</span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-sunken px-5 py-1.5 text-[11px]" data-testid="limits-bar">
      {item("Runs at once", `${l.activeRuns} of ${l.maxConcurrentRuns}`, l.activeRuns >= l.maxConcurrentRuns)}
      {l.queuedRuns > 0 && item("Queued", String(l.queuedRuns))}
      {item("Terminals", `${l.terminals} of ${l.maxTerminals}`, l.terminals >= l.maxTerminals)}
      {item("Data disk", l.diskPercent === null ? "unknown" : `${l.diskPercent}% (warn ${l.diskWarnPercent}%, stop ${l.diskStopPercent}%)`, l.diskWarn)}
      {item("Sessions stop after", `${l.maxRunSessionHours} h`)}
      {l.waiting && <span className="text-status-warning-ink">Waiting: {l.waiting}</span>}
      <Link to="/settings?tab=limits" className="ml-auto underline">Limits</Link>
    </div>
  );
}

export function useStatus() {
  return useApi<Status>("/status", ["config", "runs", "services"], 20_000);
}

/** Problems that should be in front of everyone on every page until they are fixed. */
export function StatusBanners() {
  const { data, reload } = useStatus();
  const [hideCold, setHideCold] = useState(false);
  if (!data) return null;
  const ws = data.workspace;
  return (
    <>
      {data.drain?.draining && (
        <div className="flex items-center gap-2 border-b border-status-info/40 bg-status-info-subtle px-4 py-1.5 text-xs text-status-info-ink" data-testid="drain-banner">
          <RefreshCw className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            This box is getting ready for an update{data.drain.by ? ` (${data.drain.by})` : ""}. New runs wait in the queue
            {data.drain.queuedRuns ? ` (${data.drain.queuedRuns} waiting)` : ""} and start after it;{" "}
            {data.drain.liveRuns ? `${data.drain.liveRuns} run${data.drain.liveRuns === 1 ? " is" : "s are"} finishing.` : "no runs are going."} Terminals keep working, but the box restarts soon.
          </span>
        </div>
      )}
      {data.configErrors && (
        <div className="flex gap-2 border-b border-status-critical/40 bg-status-critical-subtle px-4 py-2 text-xs text-status-critical-ink" data-testid="config-error-banner">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">config.json has errors. The last good version is still in force; saves are paused until the file is fixed.</div>
            <div className="mt-0.5 font-mono text-[11px]">{data.configPath}</div>
            <ul className="mt-1 list-disc pl-4">{data.configErrors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        </div>
      )}
      {ws?.diverged && (
        <div className="flex items-center gap-2 border-b border-status-warning/50 bg-status-warning-subtle px-4 py-2 text-xs text-status-warning-ink" data-testid="workspace-diverged-banner">
          <GitBranch className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            The box's config folder (the workspace) and its remote ({ws.branch}) have both changed. Its commits are paused{ws.uncommitted ? " and some saves are not committed yet" : ""}. Resolve it with git in a terminal in the workspace, then check again. This is only the box's own config, never your code.
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={async () => {
            await api("/workspace/sync", { body: {} }).catch((e) => toast.error(e.message));
            reload();
          }}>Check again</Button>
        </div>
      )}
      {!ws?.diverged && ws?.lastError && (
        <div className="flex items-center gap-2 border-b border-status-warning/50 bg-status-warning-subtle px-4 py-1.5 text-xs text-status-warning-ink" data-testid="workspace-error-banner">
          <GitBranch className="size-4 shrink-0" /> <span className="truncate">Config folder git: {ws.lastError}</span>
          <Link to="/settings" className="ml-auto underline">Settings</Link>
        </div>
      )}
      {data.coldStart && !hideCold && (
        <div className="flex items-center gap-2 border-b bg-sunken px-4 py-1.5 text-xs" data-testid="cold-start-banner">
          <Moon className="size-4 shrink-0" />
          <span className="flex-1">This box was asleep; terminals started fresh. Runs that were working are marked interrupted and can be resumed from their pages.</span>
          <button onClick={() => setHideCold(true)} aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      )}
      {data.limits?.diskWarn && (
        <div className="flex items-center gap-2 border-b border-status-warning/50 bg-status-warning-subtle px-4 py-1.5 text-xs text-status-warning-ink" data-testid="disk-banner">
          <AlertTriangle className="size-4 shrink-0" />
          Data disk is {data.limits.diskPercent}% full.{data.limits.diskStop ? " New runs wait in the queue until space is freed." : ""}
        </div>
      )}
      {data.dataMount?.expected && !data.dataMount.mounted && (
        <div className="flex items-center gap-2 border-b border-status-critical/40 bg-status-critical-subtle px-4 py-1.5 text-xs text-status-critical-ink" data-testid="data-mount-banner">
          <AlertTriangle className="size-4 shrink-0" />
          The data folder is not on a volume. Replacing or redeploying this box would lose the workspace, runs, sign-ins and secrets. See your hosting guide.
        </div>
      )}
    </>
  );
}
