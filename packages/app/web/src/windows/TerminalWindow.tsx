import { ChevronDown, ExternalLink, Plus, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useCan, useMe } from "@/app/context";
import type { WindowProps } from "./registry";
import { TerminalFrame } from "./TerminalFrame";

export interface PersonTerminal { name: string; title: string; cwd: string | null; command: string | null; createdBy: string | null; createdByName: string | null; createdAt: string | null }
export interface TerminalGroups {
  standing: { name: string; title: string; description: string | null; cwd: string; layout: string; alive: boolean }[];
  yours: PersonTerminal[];
  others: PersonTerminal[];
  runs: { name: string; title: string; runId: number; status: string }[];
  limit: number;
  used: number;
}

export function useTerminals() {
  return useApi<TerminalGroups>("/terminals", ["runs"], 10_000);
}

/** Window-menu actions reach the window through this event (the menu lives in the canvas frame). */
export const TERMINAL_ACTION = "wb-terminal-action";
export type TerminalAction = "new" | "rename" | "close";
export const terminalAction = (windowId: string, action: TerminalAction) => window.dispatchEvent(new CustomEvent(TERMINAL_ACTION, { detail: { windowId, action } }));

const SERVICES_NOTE = "One tab per service tailing its log, plus a ctl tab to restart them. Named services because it is the box's own; the Services page shows the same.";

export function TerminalWindow({ spec, update }: WindowProps) {
  const session: string = spec.props.session ?? "shell";
  const { data, reload } = useTerminals();
  const me = useMe();
  const [nonce, setNonce] = useState(0);
  const [showRuns, setShowRuns] = useState(false);
  const [dialog, setDialog] = useState<TerminalAction | null>(null);
  const standing = data?.standing.find((s) => s.name === session);
  const person = [...(data?.yours ?? []), ...(data?.others ?? [])].find((p) => p.name === session);
  const run = data?.runs.find((r) => r.name === session);
  const title = standing?.title ?? person?.title ?? (run ? `Run #${run.runId} · ${run.title}` : session);
  const mine = person?.createdBy === me?.email;
  const canType = useCan("member");

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ windowId: string; action: TerminalAction }>).detail;
      if (d.windowId === spec.id) setDialog(d.action);
    };
    window.addEventListener(TERMINAL_ACTION, on);
    return () => window.removeEventListener(TERMINAL_ACTION, on);
  }, [spec.id]);

  const describe =
    standing?.layout === "services" ? SERVICES_NOTE
    : standing ? standing.description ?? (standing.name === "shell" ? "A shell in the workspace. Start claude here to have Claude Code help set things up." : `Standing terminal in ${standing.cwd}`)
    : !canType ? "You are a viewer: you can watch this terminal but not type in it."
    : person && !person.createdBy ? "A Zellij session the workbench did not open (someone ran zellij in a shell)."
    : person ? `Opened by ${mine ? "you" : person.createdByName ?? person.createdBy}${person.cwd ? ` in ${person.cwd}` : ""}`
    : run ? `Run #${run.runId}'s own session (${run.status}). Steer it from the run page.`
    : "This session is not running. Pick another, or open a new terminal.";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 max-w-64 justify-between gap-1 text-xs" data-testid="terminal-picker">
              <span className="truncate">{title}</span> <ChevronDown className="size-3.5 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">Standing</DropdownMenuLabel>
            {(data?.standing ?? []).map((s) => (
              <DropdownMenuItem key={s.name} onSelect={() => update({ session: s.name })} data-testid={`terminal-pick-${s.name}`}>
                <span className="truncate">{s.title}</span>{!s.alive && <span className="ml-auto text-[10px] text-muted-foreground">starting…</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">Yours</DropdownMenuLabel>
            {(data?.yours ?? []).map((p) => <DropdownMenuItem key={p.name} onSelect={() => update({ session: p.name })} data-testid={`terminal-pick-${p.name}`}><span className="truncate">{p.title}</span></DropdownMenuItem>)}
            {!data?.yours.length && <div className="px-2 py-1 text-[11px] text-muted-foreground">None open</div>}
            {!!data?.others.length && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">Other people's</DropdownMenuLabel>
                {data.others.map((p) => (
                  <DropdownMenuItem key={p.name} onSelect={() => update({ session: p.name })} data-testid={`terminal-pick-${p.name}`}>
                    <span className="truncate">{p.title}</span><span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{p.createdByName ?? p.createdBy ?? ""}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={(e) => (e.preventDefault(), setShowRuns((v) => !v))} data-testid="terminal-show-runs">
              <span className="text-[11px] text-muted-foreground">{showRuns ? "Hide" : "Show"} run sessions ({data?.runs.length ?? 0})</span>
            </DropdownMenuItem>
            {showRuns && (data?.runs ?? []).map((r) => (
              <DropdownMenuItem key={r.name} onSelect={() => update({ session: r.name })}>
                <span className="truncate">#{r.runId} {r.title}</span><span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{r.status}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canType} onSelect={() => setDialog("new")} data-testid="terminal-new"><Plus className="size-4" /> New terminal…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={describe} data-testid="terminal-about">{describe}</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => setNonce((n) => n + 1)} aria-label="Reconnect"><RotateCw className="size-3.5" /></Button>
        <Button variant="ghost" size="icon" className="size-7" asChild aria-label="Open in new tab">
          <a href={`/term/${encodeURIComponent(session)}`} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /></a>
        </Button>
      </div>
      <div className="min-h-0 flex-1" key={nonce}>
        {/* Zellij's web client would create a session it cannot find, so only running ones load. */}
        {!data ? null : standing || person || run ? (
          <TerminalFrame session={session} />
        ) : (
          <div className="grid h-full content-center justify-items-start gap-2 p-6 text-sm" data-testid="terminal-ended">
            <p>The session <code>{session}</code> has ended.</p>
            <Button size="sm" variant="outline" onClick={() => update({ session: "shell" })}>Show the shell</Button>
          </div>
        )}
      </div>
      <NewTerminalDialog open={dialog === "new"} onClose={() => setDialog(null)} onCreated={(name) => (update({ session: name }), reload())} />
      <RenameTerminalDialog open={dialog === "rename"} terminal={person ?? null} canEdit={!!person} onClose={() => setDialog(null)} onDone={reload} />
      <CloseTerminalDialog open={dialog === "close"} terminal={person ?? null} onClose={() => setDialog(null)} onDone={() => (update({ session: "shell" }), reload())} />
    </div>
  );
}

export function NewTerminalDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (name: string) => void }) {
  const [title, setTitle] = useState("");
  const [where, setWhere] = useState("workspace");
  const [path, setPath] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) (setTitle(""), setWhere("workspace"), setPath(""), setCommand(""), setError(""));
  }, [open]);
  const create = async () => {
    try {
      const t = await api<{ name: string }>("/terminals", { body: { title, cwd: where === "path" ? path : where, command: command || undefined } });
      toast.success(`Opened ${title || "a terminal"}`);
      onCreated(t.name);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="terminal-new-dialog">
        <DialogHeader>
          <DialogTitle>New terminal</DialogTitle>
          <DialogDescription>A shell on the box that stays open when you close the window. Others can see and type in it too.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Deploy check" data-testid="terminal-new-title" />
          <Select value={where} onValueChange={setWhere}>
            <SelectTrigger data-testid="terminal-new-cwd"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="workspace">The workspace (box config)</SelectItem>
              <SelectItem value="path">Another folder…</SelectItem>
            </SelectContent>
          </Select>
          {where === "path" && <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/absolute/path/on/the/box" className="font-mono text-xs" />}
          <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="First command (optional), e.g. claude" className="font-mono text-xs" data-testid="terminal-new-command" />
          {error && <p className="text-xs text-status-critical-ink" data-testid="terminal-new-error">{error}</p>}
        </div>
        <DialogFooter><Button onClick={create} disabled={where === "path" && !path} data-testid="terminal-new-create">Open terminal</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameTerminalDialog({ open, terminal, canEdit, onClose, onDone }: { open: boolean; terminal: PersonTerminal | null; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) setTitle(terminal?.title ?? "");
  }, [open, terminal]);
  const save = async () => {
    try {
      await api(`/terminals/${terminal!.name}`, { method: "PATCH", body: { title } });
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename terminal</DialogTitle>
          <DialogDescription>{canEdit ? "Everyone sees the new name in the picker." : "Standing and run terminals are named in config or by their run."}</DialogDescription>
        </DialogHeader>
        {canEdit && <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="terminal-rename-input" />}
        <DialogFooter>{canEdit && <Button onClick={save} disabled={!title.trim()} data-testid="terminal-rename-save">Rename</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseTerminalDialog({ open, terminal, onClose, onDone }: { open: boolean; terminal: PersonTerminal | null; onClose: () => void; onDone: () => void }) {
  const end = async () => {
    try {
      await api(`/terminals/${terminal!.name}`, { method: "DELETE" });
      toast.success(`Closed ${terminal!.title}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{terminal ? `End ${terminal.title}?` : "Only terminals people opened can be ended here"}</DialogTitle>
          <DialogDescription>{terminal ? "The session and anything running in it stop for everyone. The window then shows the shell terminal." : "Standing terminals come from config.json; a run's terminal ends with the run."}</DialogDescription>
        </DialogHeader>
        <DialogFooter>{terminal && <Button variant="destructive" onClick={end} data-testid="terminal-close-confirm">End session</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
