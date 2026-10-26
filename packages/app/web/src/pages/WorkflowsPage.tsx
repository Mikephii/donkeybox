import { ShellHint } from "@/components/ShellHint";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertTriangle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorList, PageHeader } from "@/components/PageHeader";
import { api, ApiError } from "@/lib/api";
import { useCan } from "@/app/context";
import { useStatus } from "@/app/StatusBanners";
import { useApi } from "@/lib/hooks";
import { errorsAt, Field } from "./common";

export interface WorkflowSummary { id: string; title: string; description: string; autonomy: string; skill: string | null; skillExists: boolean; open: number; rules: number; actions: number }

export const AUTONOMY: Record<string, string> = {
  autonomous: "Acts on its own; no requests unless something is unclear.",
  "ask-first": "Raises a request before changing anything.",
  guarded: "Acts freely, but tool calls matching the guard patterns pause for a person.",
};

export function WorkflowsPage() {
  const { data } = useApi<WorkflowSummary[]>("/workflows", ["config", "requests"]);
  const isAdmin = useCan("admin");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader need="admin" title="Workflows" description="A workflow is a group: its buttons, its policy, the rules that start it, and the skill the agent follows." subject="page:/workflows">
        {isAdmin && <Button size="sm" className="h-8 gap-1" asChild><Link to="/workflows/new" data-testid="new-workflow"><Plus className="size-4" /> New workflow</Link></Button>}
      </PageHeader>
      <ShellHint bar>Workflows and their rules are the <code>groups</code> and <code>rules</code> in the workspace's <code>config.json</code>, and skills are folders in <code>.claude/skills</code>. Edit them in a terminal or the editor, ask <code>claude</code> in the shell to do it, or keep skills in your own repos. The workspace is an ordinary folder and git repo; set it up however your team works.</ShellHint>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="workflow-list">
          {(data ?? []).map((w) => (
            <Link key={w.id} to={`/workflows/${w.id}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-foreground/30" data-testid={`workflow-card-${w.id}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{w.title}</span>
                <Badge variant="outline" className="h-5 text-[10px]">{w.autonomy}</Badge>
                {w.open > 0 && <Badge variant="warning" className="ml-auto h-5 text-[10px]">{w.open} open</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{w.description || "No description."}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="font-mono">{w.id}</span>
                <span>{w.actions} buttons</span>
                <span>{w.rules} rules</span>
                {w.skill ? (
                  w.skillExists ? <span>skill /{w.skill}</span> : <span className="flex items-center gap-1 text-status-warning-ink"><AlertTriangle className="size-3" /> skill /{w.skill} missing</span>
                ) : <span className="text-status-warning-ink">no skill</span>}
              </div>
            </Link>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

const PRESETS: Record<string, { label: string; actions: (id: string) => unknown[] }> = {
  "approve-reject": {
    label: "Approve / Reject",
    actions: (id) => [
      { id: "approve", label: "Approve", style: "primary", prompt: `/${id} approved {{request.id}}` },
      { id: "reject", label: "Reject", style: "danger", prompt: `/${id} rejected {{request.id}}` },
    ],
  },
  "approve-changes-reject": {
    label: "Approve / Needs changes / Reject",
    actions: (id) => [
      { id: "approve", label: "Approve", style: "primary", prompt: `/${id} approved {{request.id}}` },
      { id: "changes", label: "Needs changes", input: { note: "text" }, prompt: `/${id} changes {{request.id}}: {{input.note}}` },
      { id: "reject", label: "Reject", style: "danger", prompt: `/${id} rejected {{request.id}}` },
    ],
  },
  none: { label: "No buttons yet", actions: () => [] },
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function NewWorkflowPage() {
  const skillsDir = useStatus().data?.skillsDir ?? ".claude/skills";
  const navigate = useNavigate();
  const [f, setF] = useState({ title: "", id: "", idTouched: false, description: "", autonomy: "ask-first", model: "haiku", preset: "approve-changes-reject", skill: true, withRule: false, on: "", prompt: "", mode: "interactive" });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const id = f.idTouched ? f.id : slug(f.title);
  const { data: sources } = useApi<{ id: string; emits: { exact?: string; prefix?: string } }[]>("/sources", ["config"]);
  const eventTypes = useMemo(() => [...new Set((sources ?? []).flatMap((s) => (s.emits.exact ? [s.emits.exact] : s.emits.prefix === "github." ? ["github.pull_request.merged", "github.push", "github.issues.opened"] : s.emits.prefix === "jira." ? ["jira.issue.created", "jira.issue.updated", "jira.comment.created"] : [])))], [sources]);

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    try {
      await api("/workflows", {
        body: {
          id,
          group: { title: f.title, description: f.description || undefined, autonomy: f.autonomy, model: f.model || undefined, actions: PRESETS[f.preset]!.actions(id) },
          skill: f.skill,
          rule: f.withRule ? { on: f.on, prompt: f.prompt || `/${id} {{payload.summary}}`, mode: f.mode } : null,
        },
      });
      navigate(`/workflows/${id}`);
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader need="admin" title="New workflow" description="Creates the group, a starter skill and, if you like, the rule that starts it. Everything can be edited afterwards." subject="page:/workflows/new" />
      <ShellHint bar>A shortcut for adding a group to <code>config.json</code> and a skill folder. You can write both by hand, or ask <code>claude</code> in the shell to build the whole workflow.</ShellHint>
      <ScrollArea className="min-h-0 flex-1">
        <form className="mx-auto grid max-w-2xl gap-4 p-6" onSubmit={(e) => (e.preventDefault(), submit())} data-testid="new-workflow-form">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" errors={errorsAt(errors, "group.title")}>
              <Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Email Jeff" data-testid="wf-title" />
            </Field>
            <Field label="ID (also the skill's slash command)" errors={[...errorsAt(errors, "id"), ...errors.filter((e) => e.startsWith("workflow ") || e.startsWith("invalid id"))]} hint={`/${id || "…"}`}>
              <Input value={id} onChange={(e) => setF({ ...f, id: e.target.value, idTouched: true })} className="font-mono" data-testid="wf-id" />
            </Field>
          </div>
          <Field label="Description" errors={errorsAt(errors, "group.description")}>
            <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Drafts emails to Jeff; nothing is sent without a click." data-testid="wf-description" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Autonomy" hint={AUTONOMY[f.autonomy]}>
              <Select value={f.autonomy} onValueChange={(v) => setF({ ...f, autonomy: v })}>
                <SelectTrigger data-testid="wf-autonomy"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(AUTONOMY).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Model" hint="Leave empty for the Claude Code default.">
              <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="haiku" />
            </Field>
          </div>
          <Field label="Buttons to start with">
            <Select value={f.preset} onValueChange={(v) => setF({ ...f, preset: v })}>
              <SelectTrigger data-testid="wf-preset"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PRESETS).map(([k, p]) => <SelectItem key={k} value={k}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.skill} onCheckedChange={(c) => setF({ ...f, skill: c === true })} data-testid="wf-skill" /> Create a starter skill <span className="font-mono text-xs text-muted-foreground">{skillsDir}/{id || "…"}/SKILL.md</span></label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.withRule} onCheckedChange={(c) => setF({ ...f, withRule: c === true })} data-testid="wf-with-rule" /> Start it automatically when an event happens</label>
          {f.withRule && (
            <div className="grid gap-3 rounded-md border p-3">
              <Field label="When this event type happens (glob)" errors={errorsAt(errors, "rule.on")}>
                <Input list="wf-event-types" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} placeholder="jira.issue.created" className="font-mono text-xs" data-testid="wf-rule-on" />
                <datalist id="wf-event-types">{eventTypes.map((t) => <option key={t} value={t} />)}</datalist>
              </Field>
              <Field label="Run this prompt" hint="A slash command; {{payload.x}} fills in event fields." errors={errorsAt(errors, "rule.prompt")}>
                <Input value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} placeholder={`/${id || "workflow"} {{payload.summary}}`} className="font-mono text-xs" data-testid="wf-rule-prompt" />
              </Field>
            </div>
          )}
          <ErrorList errors={errors.filter((e) => !/^(group\.(title|description)|rule\.(on|prompt)|id)[.:]/.test(e))} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !f.title || !id} data-testid="wf-create">Create workflow</Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/workflows")}>Cancel</Button>
          </div>
        </form>
      </ScrollArea>
    </div>
  );
}
