import { ShellHint } from "@/components/ShellHint";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Download, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorList, PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useStatus } from "@/app/StatusBanners";
import { SecretValueMenu, toSecretName } from "@/components/Secrets";
import { useCan } from "@/app/context";
import { Gate } from "@/components/Gate";
import { editorUrl } from "@/windows/CodeWindow";
import { useApi } from "@/lib/hooks";
import { Markdown } from "@/app/Markdown";
import { AUTONOMY } from "./WorkflowsPage";
import { errorsAt, Field, KeyValues, StringList, useUrlState } from "./common";

interface Rule { id: string; on: string; filter: Record<string, unknown>; prompt: string; group: string; mode: "interactive" | "print"; goal?: string; title?: string; enabled: boolean }
interface WorkflowView {
  id: string;
  group: Record<string, any>;
  rules: Rule[];
  sources: { id: string; source: Record<string, any>; rules: string[]; emits: { exact?: string; prefix?: string }; nextRun: string | null }[];
  skill: { name: string; exists: boolean; content: string | null } | null;
  open: number;
}

const TABS = [
  ["settings", "Settings"],
  ["actions", "Actions"],
  ["guards", "Guards & tools"],
  ["mcp", "MCP servers"],
  ["rules", "Rules"],
  ["sources", "Sources"],
  ["skill", "Skill"],
  ["json", "JSON"],
] as const;

const errorsFrom = (e: unknown) => (e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);

export function WorkflowPage() {
  const isAdmin = useCan("admin");
  const { id = "" } = useParams();
  const u = useUrlState();
  const tab = u.get("tab") || "settings";
  const { data, error, reload } = useApi<WorkflowView>(`/workflows/${id}`, ["config"], 60_000);
  const [group, setGroup] = useState<Record<string, any> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setGroup(structuredClone(data.group));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (patch: Record<string, unknown>) => {
    setGroup((g) => ({ ...g!, ...patch }));
    setDirty(true);
  };

  const saveGroup = async (next = group) => {
    try {
      await api(`/workflows/${id}`, { method: "PUT", body: { group: clean(next!) } });
      setErrors([]);
      setDirty(false);
      toast.success("Workflow saved to config.json");
      reload();
    } catch (e) {
      setErrors(errorsFrom(e));
    }
  };

  if (error) return <div className="p-6 text-sm text-status-critical-ink">{error}. <Link to="/workflows" className="underline">Back to workflows</Link></div>;
  if (!data || !group) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const groupTab = ["settings", "actions", "guards", "mcp", "json"].includes(tab);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={`workflow-page-${id}`}>
      <PageHeader need="admin" title={<>{group.title} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{id}</span></>} description={group.description} subject={`workflow:${id}`}>
        {data.open > 0 && <Button variant="outline" size="sm" className="h-8" asChild><Link to={`/inbox?group=${id}`}>{data.open} open requests</Link></Button>}
        <Button variant="outline" size="sm" className="h-8" asChild><Link to={`/runs?group=${id}`}>Runs</Link></Button>
        {groupTab && (
          <Button size="sm" className="h-8" disabled={!dirty || !isAdmin} onClick={() => saveGroup()} data-testid="wf-save">{dirty ? "Save changes" : "Saved"}</Button>
        )}
      </PageHeader>
      <ShellHint bar>This workflow is <code>groups.{id}</code> in the workspace's <code>config.json</code>, and its rules are in <code>rules</code>. Edit them there by hand, or ask <code>claude</code> in the shell, if you prefer; this page is one way of doing it.</ShellHint>
      <nav className="flex gap-1 border-b px-5 pt-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => u.set({ tab: k === "settings" ? null : k })} data-testid={`wf-tab-${k}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-xs", tab === k ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
            {k === "rules" && <span className="ml-1 text-muted-foreground">{data.rules.length}</span>}
            {k === "actions" && <span className="ml-1 text-muted-foreground">{group.actions?.length ?? 0}</span>}
          </button>
        ))}
      </nav>
      <ScrollArea className="min-h-0 flex-1">
        <Gate need="admin">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          {groupTab && <ErrorList errors={errors.filter((e) => !/^group\.(title|description|skill|autonomy|model|workdir|addDirs|webAccess|actions|guard|allowedTools|notify|mcpServers|extraSkillDirs|pluginDirs)/.test(e))} />}
          {tab === "settings" && <SettingsTab id={id} group={group} edit={edit} errors={errors} skill={data.skill} />}
          {tab === "actions" && <ActionsTab group={group} edit={edit} errors={errors} />}
          {tab === "guards" && <GuardsTab group={group} edit={edit} errors={errors} />}
          {tab === "mcp" && <McpTab id={id} group={group} edit={edit} errors={errors} />}
          {tab === "rules" && <RulesTab id={id} rules={data.rules} onSaved={reload} />}
          {tab === "sources" && <SourcesTab view={data} />}
          {tab === "skill" && <SkillTab view={data} group={group} onSaved={reload} />}
          {tab === "json" && <JsonTab group={group} onSave={(g) => (setGroup(g), saveGroup(g))} errors={errors} />}
        </div>
        </Gate>
      </ScrollArea>
    </div>
  );
}

/** Drops empty optional fields so the saved JSON stays tidy. */
function clean(g: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(g)) {
    if (v === "" || v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0 && k !== "actions") continue;
    if (k === "guard" || k === "allowedTools" || k === "notify") {
      const list = (v as string[]).map((s) => s.trim()).filter(Boolean);
      if (list.length) out[k] = list;
      continue;
    }
    out[k] = v;
  }
  return out;
}

type TabProps = { group: Record<string, any>; edit: (p: Record<string, unknown>) => void; errors: string[] };

function SettingsTab({ id, group, edit, errors, skill }: TabProps & { id: string; skill: WorkflowView["skill"] }) {
  const navigate = useNavigate();
  const { data: skills } = useApi<{ name: string }[]>("/skills", ["config"]);
  const [deleteSkill, setDeleteSkill] = useState(true);
  const [delErrors, setDelErrors] = useState<string[]>([]);
  const remove = async () => {
    try {
      await api(`/workflows/${id}${deleteSkill ? "?skill=1" : ""}`, { method: "DELETE" });
      toast.success(`Deleted ${group.title}`);
      navigate("/workflows");
    } catch (e) {
      setDelErrors([(e as Error).message]);
    }
  };
  return (
    <div className="grid gap-4" data-testid="wf-settings">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" errors={errorsAt(errors, "group.title")}><Input value={group.title ?? ""} onChange={(e) => edit({ title: e.target.value })} data-testid="wf-field-title" /></Field>
        <Field label="Skill (slash command)" errors={errorsAt(errors, "group.skill")} hint={skill && !skill.exists ? <span className="text-status-warning-ink">No SKILL.md yet; create it on the Skill tab.</span> : `/${group.skill ?? ""}`}>
          <Input list="wf-skills" value={group.skill ?? ""} onChange={(e) => edit({ skill: e.target.value })} className="font-mono" />
          <datalist id="wf-skills">{(skills ?? []).map((s) => <option key={s.name} value={s.name} />)}</datalist>
        </Field>
      </div>
      <Field label="Description" errors={errorsAt(errors, "group.description")}><Textarea rows={2} value={group.description ?? ""} onChange={(e) => edit({ description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Autonomy" hint={AUTONOMY[group.autonomy ?? "ask-first"]} errors={errorsAt(errors, "group.autonomy")}>
          <Select value={group.autonomy ?? "ask-first"} onValueChange={(v) => edit({ autonomy: v })}>
            <SelectTrigger data-testid="wf-field-autonomy"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.keys(AUTONOMY).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Model" hint="Empty uses the Claude Code default." errors={errorsAt(errors, "group.model")}><Input value={group.model ?? ""} onChange={(e) => edit({ model: e.target.value })} placeholder="haiku" /></Field>
      </div>
      <Field label="Notify" hint="These people get a toast when this workflow raises a request." errors={errorsAt(errors, "group.notify")}>
        <StringList value={group.notify ?? []} onChange={(v) => edit({ notify: v })} placeholder="person@example.com" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Working folder (optional)" hint={<>Where runs start: any folder on the box, absolute or relative to the workspace. Empty gives each run a fresh folder. The workbench never manages what is in it, so if it is a code repo, the skill says how to branch, commit or push.</>} errors={errorsAt(errors, "group.workdir")}>
          <Input value={group.workdir ?? ""} onChange={(e) => edit({ workdir: e.target.value || undefined })} placeholder="/home/workbench/code/shop" className="font-mono text-xs" data-testid="wf-workdir" />
        </Field>        <Field label="Parallel runs" hint="Off: runs that share the working folder take turns.">
          <label className="flex h-9 items-center gap-2 text-sm"><Checkbox checked={!!group.parallel} onCheckedChange={(c) => edit({ parallel: c === true })} /> Allow</label>
        </Field>
        <Field label="More skill folders" hint="Folders holding <name>/SKILL.md, relative to the workspace or absolute. Their skills are added to this workflow's runs." errors={errorsAt(errors, "group.extraSkillDirs")}>
          <StringList value={group.extraSkillDirs ?? []} onChange={(v) => edit({ extraSkillDirs: v.length ? v : undefined })} placeholder="shared/skills" testid="wf-extra-skills" />
        </Field>
        <Field label="More folders runs may use" hint="Passed to Claude Code with --add-dir, so runs can read and change files there too." errors={errorsAt(errors, "group.addDirs")}>
          <StringList value={group.addDirs ?? []} onChange={(v) => edit({ addDirs: v.length ? v : undefined })} placeholder="/home/workbench/code/shared" testid="wf-add-dirs" />
        </Field>
        <Field label="Claude Code plugin folders" hint="Each is passed to this workflow's runs with --plugin-dir. Missing folders are skipped." errors={errorsAt(errors, "group.pluginDirs")}>
          <StringList value={group.pluginDirs ?? []} onChange={(v) => edit({ pluginDirs: v.length ? v : undefined })} placeholder="plugins/our-plugin" testid="wf-plugin-dirs" />
        </Field>
      </div>
      <div className="mt-6 space-y-2 rounded-md border border-destructive/40 p-4">
        <div className="text-sm font-medium">Delete this workflow</div>
        <p className="text-xs text-muted-foreground">Refused while rules still start it. Requests and runs stay in the history.</p>
        <label className="flex items-center gap-2 text-xs"><Checkbox checked={deleteSkill} onCheckedChange={(c) => setDeleteSkill(c === true)} /> Also delete its skill if no other workflow uses it</label>
        <ErrorList errors={delErrors} />
        <Button variant="destructive" size="sm" onClick={remove} data-testid="wf-delete"><Trash2 className="size-4" /> Delete workflow</Button>
      </div>
    </div>
  );
}

const FIELD_TYPES = ["string", "text", "number", "boolean", "enum"] as const;

function ActionsTab({ group, edit, errors }: TabProps) {
  const actions: any[] = group.actions ?? [];
  const set = (i: number, patch: Record<string, unknown>) => edit({ actions: actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const move = (i: number, d: number) => {
    const next = [...actions];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    edit({ actions: next });
  };
  return (
    <div className="grid gap-3" data-testid="wf-actions">
      <p className="text-xs text-muted-foreground">
        Buttons on this workflow's requests. Pressing one sends its prompt back to the agent; <code>{"{{request.id}}"}</code>, <code>{"{{request.title}}"}</code> and <code>{"{{input.field}}"}</code> fill in. An agent can also offer its own buttons on a single request.
      </p>
      {actions.map((a, i) => {
        const p = `group.actions.${i}`;
        const inputs: [string, any][] = Object.entries(a.input ?? {});
        const setInputs = (rows: [string, any][]) => set(i, { input: rows.length ? Object.fromEntries(rows) : undefined });
        return (
          <div key={i} className="grid gap-3 rounded-md border p-3" data-testid={`wf-action-${i}`}>
            <div className="grid grid-cols-[1fr_1fr_8rem_auto] items-start gap-2">
              <Field label="Label" errors={errorsAt(errors, `${p}.label`)}><Input value={a.label ?? ""} onChange={(e) => set(i, { label: e.target.value })} className="h-8" data-testid={`wf-action-${i}-label`} /></Field>
              <Field label="ID" errors={errorsAt(errors, `${p}.id`)}><Input value={a.id ?? ""} onChange={(e) => set(i, { id: e.target.value })} className="h-8 font-mono text-xs" data-testid={`wf-action-${i}-id`} /></Field>
              <Field label="Style">
                <Select value={a.style ?? "secondary"} onValueChange={(v) => set(i, { style: v })}>
                  <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{["primary", "secondary", "danger"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="flex gap-0.5 pt-6">
                <Button variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
                <Button variant="ghost" size="icon" className="size-8" disabled={i === actions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => edit({ actions: actions.filter((_, j) => j !== i) })} aria-label="Remove action"><X className="size-4" /></Button>
              </div>
            </div>
            <Field label="Prompt sent back to the agent" errors={errorsAt(errors, `${p}.prompt`)}>
              <Textarea rows={2} value={a.prompt ?? ""} onChange={(e) => set(i, { prompt: e.target.value || undefined })} className="font-mono text-xs" placeholder={`/${group.skill ?? "skill"} ${a.id ?? "action"} {{request.id}}`} data-testid={`wf-action-${i}-prompt`} />
            </Field>
            <Field label="Form fields shown when pressed" errors={errorsAt(errors, `${p}.input`)}>
              <div className="grid gap-1.5">
                {inputs.map(([name, t], k) => {
                  const kind = typeof t === "object" && t?.enum ? "enum" : t;
                  return (
                    <div key={k} className="flex gap-1.5">
                      <Input className="h-8 font-mono text-xs" value={name} placeholder="field" onChange={(e) => setInputs(inputs.map((r, j) => (j === k ? [e.target.value, r[1]] : r)))} />
                      <Select value={kind} onValueChange={(v) => setInputs(inputs.map((r, j) => (j === k ? [r[0], v === "enum" ? { enum: ["option"] } : v] : r)))}>
                        <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{FIELD_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                      {kind === "enum" && (
                        <Input className="h-8 text-xs" value={(t.enum as string[]).join(", ")} placeholder="option a, option b"
                          onChange={(e) => setInputs(inputs.map((r, j) => (j === k ? [r[0], { enum: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }] : r)))} />
                      )}
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setInputs(inputs.filter((_, j) => j !== k))} aria-label="Remove field"><X className="size-3.5" /></Button>
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs" onClick={() => setInputs([...inputs, [`field${inputs.length + 1}`, "text"]])}><Plus className="size-3.5" /> Add field</Button>
              </div>
            </Field>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="w-fit gap-1" onClick={() => edit({ actions: [...actions, { id: `action-${actions.length + 1}`, label: "New button", style: "secondary" }] })} data-testid="wf-add-action">
        <Plus className="size-4" /> Add button
      </Button>
    </div>
  );
}

function GuardsTab({ group, edit, errors }: TabProps) {
  return (
    <div className="grid gap-5">
      <Field label="Guard patterns" errors={errorsAt(errors, "group.guard")}
        hint={<>Tool calls matching these pause until someone allows or denies them. Claude Code permission syntax: <code>Bash(jira delete*)</code>, <code>mcp__jira__delete_*</code>, <code>Write(/etc/**)</code>.</>}>
        <StringList value={group.guard ?? []} onChange={(v) => edit({ guard: v })} placeholder="Bash(mail send*)" testid="wf-guards" />
      </Field>
      <Field label="Web access" hint="Searching and fetching pages can carry instructions written for the agent (prompt injection). Turn it off for workflows that also hold write tools or tokens and do not need the web.">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={group.webAccess !== false} onCheckedChange={(c) => edit({ webAccess: c === true ? undefined : false })} data-testid="wf-web-access" />
          Runs may search and fetch the web (WebSearch and WebFetch)
        </label>
      </Field>
      <Field label="Allowed tools" errors={errorsAt(errors, "group.allowedTools")}
        hint={<>Runs refuse any tool not allowed here or in the base set (read, write, edit, workbench tools, <code>wb</code>). Shell commands look like <code>Bash(mail:*)</code>.</>}>
        <StringList value={group.allowedTools ?? []} onChange={(v) => edit({ allowedTools: v })} placeholder="Bash(mail:*)" testid="wf-allowed" />
      </Field>
    </div>
  );
}

function McpTab({ id, group, edit, errors }: TabProps & { id: string }) {
  const [importing, setImporting] = useState(false);
  const servers: [string, any][] = Object.entries(group.mcpServers ?? {});
  const write = (rows: [string, any][]) => edit({ mcpServers: rows.length ? Object.fromEntries(rows) : undefined });
  const set = (i: number, patch: Record<string, unknown>) => write(servers.map((r, j) => (j === i ? [r[0], { ...r[1], ...patch }] : r)));
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        MCP servers this workflow's runs can use, on top of the workbench's own. Their tools are named <code>mcp__NAME__tool</code>: allow them on the Guards &amp; tools tab, and guard the destructive ones.
        Put tokens in the secrets store and refer to them as <code>{"${secret:NAME}"}</code>; the key button next to a value does that for you.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setImporting(true)} data-testid="mcp-import"><Download className="size-3.5" /> Import from Claude Code</Button>
        <span className="text-muted-foreground">Add and sign in with <code>claude mcp add …</code> in a terminal on the box, then import it here. Runs use the same sign-in. Or write servers straight into this workflow's <code>mcpServers</code> in <code>config.json</code>.</span>
      </div>
      <McpImportDialog id={id} open={importing} onClose={() => setImporting(false)} onImported={(defs) => edit({ mcpServers: { ...(group.mcpServers ?? {}), ...defs } })} />
      <ErrorList errors={errorsAt(errors, "group.mcpServers")} />
      {servers.map(([name, s], i) => (
        <div key={i} className="grid gap-3 rounded-md border p-3" data-testid={`wf-mcp-${i}`}>
          <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <Field label="Name"><Input value={name} onChange={(e) => write(servers.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} className="h-8 font-mono text-xs" /></Field>
            <Field label="Type">
              <Select value={s.type ?? "stdio"} onValueChange={(v) => set(i, { type: v })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="stdio">stdio</SelectItem><SelectItem value="http">http</SelectItem><SelectItem value="sse">sse</SelectItem></SelectContent>
              </Select>
            </Field>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => write(servers.filter((_, j) => j !== i))} aria-label="Remove server"><X className="size-4" /></Button>
          </div>
          {(s.type ?? "stdio") === "stdio" ? (
            <>
              <Field label="Command"><Input value={s.command ?? ""} onChange={(e) => set(i, { command: e.target.value })} className="h-8 font-mono text-xs" placeholder="npx" /></Field>
              <Field label="Arguments"><StringList value={s.args ?? []} onChange={(v) => set(i, { args: v })} placeholder="-y" /></Field>
              <Field label="Environment"><KeyValues value={s.env ?? {}} onChange={(v) => set(i, { env: v })} keyPlaceholder="NAME" valuePlaceholder="${secret:NAME}" rowExtra={(k, v, setV) => <SecretValueMenu value={v} onChange={setV} suggest={toSecretName(`${name}_${k}`)} />} /></Field>
            </>
          ) : (
            <>
              <Field label="URL"><Input value={s.url ?? ""} onChange={(e) => set(i, { url: e.target.value })} className="h-8 font-mono text-xs" placeholder="https://mcp.example.com/mcp" /></Field>
              <Field label="Headers"><KeyValues value={s.headers ?? {}} onChange={(v) => set(i, { headers: v })} keyPlaceholder="Authorization" valuePlaceholder="Bearer ${secret:NAME}" rowExtra={(k, v, setV) => <SecretValueMenu value={v} onChange={setV} suggest={toSecretName(`${name}_${k === "Authorization" ? "token" : k}`)} />} /></Field>
            </>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit gap-1" onClick={() => write([...servers, [`server${servers.length + 1}`, { type: "stdio", command: "", args: [] }]])}><Plus className="size-4" /> Add MCP server</Button>
    </div>
  );
}

function RulesTab({ id, rules, onSaved }: { id: string; rules: Rule[]; onSaved: () => void }) {
  const [list, setList] = useState<Rule[]>(rules);
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setList(rules);
  }, [rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, patch: Partial<Rule>) => (setList(list.map((r, j) => (j === i ? { ...r, ...patch } : r))), setDirty(true));
  const save = async () => {
    try {
      await api(`/workflows/${id}/rules`, { method: "PUT", body: { rules: list } });
      setErrors([]);
      setDirty(false);
      toast.success("Rules saved");
      onSaved();
    } catch (e) {
      setErrors(errorsFrom(e));
    }
  };
  return (
    <div className="grid gap-3" data-testid="wf-rules">
      <p className="text-xs text-muted-foreground">A rule starts this workflow when an event arrives. The event type comes from a source (see the Sources tab) or from the workbench itself, such as <code>run.done</code> or <code>request.answered</code>.</p>
      <ErrorList errors={errors.filter((e) => !/^rules\.\d+\.(id|on|prompt|goal|title)/.test(e))} />
      {list.map((r, i) => {
        const p = `rules.${i}`;
        return (
          <div key={i} className="grid gap-3 rounded-md border p-3" data-testid={`wf-rule-${i}`}>
            <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
              <Field label="Rule ID" errors={errorsAt(errors, `${p}.id`)}><Input value={r.id} onChange={(e) => set(i, { id: e.target.value })} className="h-8 font-mono text-xs" /></Field>
              <Field label="When event type matches" errors={errorsAt(errors, `${p}.on`)}><Input value={r.on} onChange={(e) => set(i, { on: e.target.value })} className="h-8 font-mono text-xs" placeholder="github.pull_request.merged" /></Field>
              <div className="flex items-center gap-2 pt-6">
                <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={r.enabled !== false} onCheckedChange={(c) => set(i, { enabled: c === true })} /> On</label>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => (setList(list.filter((_, j) => j !== i)), setDirty(true))} aria-label="Remove rule"><X className="size-4" /></Button>
              </div>
            </div>
            <Field label="Only when the payload has" hint="Exact values; * works as a wildcard.">
              <KeyValues value={Object.fromEntries(Object.entries(r.filter ?? {}).map(([k, v]) => [k, String(v)]))} onChange={(v) => set(i, { filter: v })} keyPlaceholder="repo" valuePlaceholder="example/shop" />
            </Field>
            <Field label="Prompt" hint="Usually a slash command; {{payload.x}} and {{event.summary}} fill in." errors={errorsAt(errors, `${p}.prompt`)}>
              <Textarea rows={2} value={r.prompt} onChange={(e) => set(i, { prompt: e.target.value })} className="font-mono text-xs" />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Run title (optional)" errors={errorsAt(errors, `${p}.title`)}><Input value={r.title ?? ""} onChange={(e) => set(i, { title: e.target.value || undefined })} className="h-8 text-xs" /></Field>
              <Field label="Mode">
                <Select value={r.mode ?? "interactive"} onValueChange={(v) => set(i, { mode: v as Rule["mode"] })}>
                  <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="interactive">Interactive</SelectItem><SelectItem value="print">Print (headless)</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Goal check (optional)" errors={errorsAt(errors, `${p}.goal`)}><Input value={r.goal ?? ""} onChange={(e) => set(i, { goal: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="test -f DONE" /></Field>
            </div>
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="gap-1" onClick={() => (setList([...list, { id: `${id}-${list.length + 1}`, on: "", filter: {}, prompt: `/${id} `, group: id, mode: "interactive", enabled: true }]), setDirty(true))} data-testid="wf-add-rule">
          <Plus className="size-4" /> Add rule
        </Button>
        <Button size="sm" disabled={!dirty} onClick={save} data-testid="wf-save-rules">Save rules</Button>
      </div>
    </div>
  );
}

function SourcesTab({ view }: { view: WorkflowView }) {
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">Sources whose events reach this workflow through its rules. Manage endpoints, secrets and test deliveries on the <Link to="/sources" className="underline">Sources page</Link>.</p>
      {view.sources.length === 0 && <p className="text-sm text-muted-foreground">No source feeds this workflow yet. Add a rule whose event type a source emits, or start runs by hand.</p>}
      {view.sources.map((s) => (
        <Link key={s.id} to={`/sources?s=${s.id}`} className="rounded-md border p-3 hover:border-foreground/30">
          <div className="flex items-center gap-2 text-sm font-medium">{s.source.title ?? s.id} <Badge variant="outline" className="text-[10px]">{s.source.schedule ? "schedule" : "webhook"}</Badge></div>
          <div className="mt-1 text-xs text-muted-foreground">
            {s.source.path ?? s.source.schedule} · emits <code>{s.emits.exact ?? `${s.emits.prefix}*`}</code> · feeds {s.rules.join(", ")}
            {s.nextRun && <> · next {new Date(s.nextRun).toLocaleString()}</>}
          </div>
        </Link>
      ))}
    </div>
  );
}

function SkillTab({ view, group, onSaved }: { view: WorkflowView; group: Record<string, any>; onSaved: () => void }) {
  const status = useStatus().data;
  const skillsDir = status?.skillsDir ?? ".claude/skills";
  const editor = status?.editor;
  const name: string | undefined = group.skill;
  const [content, setContent] = useState(view.skill?.content ?? "");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setContent(view.skill?.content ?? "");
  }, [view.skill?.content]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo(() => content.replace(/^---[\s\S]*?---\s*/, ""), [content]);
  if (!name) return <p className="text-sm text-muted-foreground">Set a skill name on the Settings tab first.</p>;
  const starter = `---\nname: ${name}\ndescription: ${group.description || `${group.title}. Use for work in the ${name} group.`}\n---\n\n# ${group.title}\n\nWhat this workflow does, the arguments after /${name}, and what to do when each button's prompt comes back.\n`;
  const save = async () => {
    try {
      await api(`/skills/${name}`, { method: "PUT", body: { content } });
      setErrors([]);
      setDirty(false);
      toast.success(`Saved ${skillsDir}/${name}/SKILL.md`);
      onSaved();
    } catch (e) {
      setErrors(errorsFrom(e));
    }
  };
  return (
    <div className="grid gap-3" data-testid="wf-skill">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground">{skillsDir}/{name}/SKILL.md</span>
        {editor?.on && <a href={editorUrl({ folder: editor.workspaceDir })} target="_blank" rel="noreferrer" className="underline" data-testid="skill-open-editor">open in editor</a>}
        {!view.skill?.exists && !dirty && <Badge variant="warning">not created yet</Badge>}
        <div className="ml-auto flex rounded-md border p-0.5">
          {(["edit", "preview"] as const).map((m) => (
            <button key={m} className={cn("rounded px-2 py-0.5", m === mode ? "bg-secondary font-medium" : "text-muted-foreground")} onClick={() => setMode(m)} data-testid={`wf-skill-${m}`}>{m === "edit" ? "Edit" : "Preview"}</button>
          ))}
        </div>
      </div>
      <ShellHint>
        A skill is a plain markdown file. Write it however you like: in a terminal, in the editor, with <code>claude</code> (which knows how to write skills), or on a laptop clone of the workspace.
        If this workflow's working folder is one of your code repos, skills and a <code>CLAUDE.md</code> in that repo reach its runs too. Edits here are committed to the box's config repo, which is never your code.
      </ShellHint>
      {!view.skill?.exists && !content && <Button variant="outline" size="sm" className="w-fit" onClick={() => (setContent(starter), setDirty(true))} data-testid="wf-skill-starter">Start from a template</Button>}
      {mode === "edit" ? (
        <Textarea value={content} onChange={(e) => (setContent(e.target.value), setDirty(true))} className="min-h-[420px] font-mono text-xs" spellCheck={false} data-testid="wf-skill-editor" />
      ) : (
        <div className="min-h-[420px] rounded-md border p-4"><Markdown>{body || "_Empty_"}</Markdown></div>
      )}
      <p className="text-[11px] text-muted-foreground">Must start with frontmatter whose <code>name</code> is <code>{name}</code> and that has a <code>description</code>. Claude reads the description to decide when the skill applies.</p>
      <ErrorList errors={errors} />
      <Button size="sm" className="w-fit" disabled={!dirty} onClick={save} data-testid="wf-skill-save">Save skill</Button>
    </div>
  );
}

function JsonTab({ group, onSave, errors }: { group: Record<string, any>; onSave: (g: Record<string, any>) => void; errors: string[] }) {
  const [text, setText] = useState(JSON.stringify(group, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">The workflow exactly as stored in the workspace's <code>config.json</code>. The server validates it before writing.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[420px] font-mono text-xs" spellCheck={false} data-testid="wf-json" />
      <ErrorList errors={[...(parseError ? [parseError] : []), ...errors]} />
      <Button size="sm" className="w-fit" onClick={() => {
        try {
          const g = JSON.parse(text);
          setParseError(null);
          onSave(g);
        } catch (e) {
          setParseError(`JSON: ${(e as Error).message}`);
        }
      }} data-testid="wf-json-save">Save JSON</Button>
    </div>
  );
}

interface FoundServer { key: string; name: string; scope: "user" | "local" | "project"; where: string | null; type: string; summary: string; secrets: string[] }

/** Lists the box user's Claude Code MCP servers; importing stores their secrets and adds them to the form. */
function McpImportDialog({ id, open, onClose, onImported }: { id: string; open: boolean; onClose: () => void; onImported: (defs: Record<string, unknown>) => void }) {
  const { data } = useApi<{ configPath: string; servers: FoundServer[] }>(open ? "/mcp/claude-code" : null, []);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ imported: string[]; servers: Record<string, unknown>; secretsCreated: string[] }>(`/workflows/${id}/mcp/import`, { body: { keys: picked, save: false } });
      onImported(r.servers);
      toast.success(`Added ${r.imported.join(", ")}${r.secretsCreated.length ? `; stored ${r.secretsCreated.join(", ")} as secrets` : ""}. Save the workflow to keep them.`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const scopeLabel = (s: FoundServer) => (s.scope === "user" ? "all projects" : s.scope === "local" ? `only in ${s.where}` : `.mcp.json in ${s.where}`);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="mcp-import-dialog">
        <DialogHeader>
          <DialogTitle>Import MCP servers from Claude Code</DialogTitle>
          <DialogDescription>Servers the box's Claude Code user has set up ({data?.configPath ?? "~/.claude.json"} and project .mcp.json files). Values that look like secrets move into the secrets store; the workflow keeps only their names.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {!data && <p className="text-xs text-muted-foreground">Reading…</p>}
          {data && !data.servers.length && <p className="text-xs text-muted-foreground">None yet. In a terminal on the box run <code>claude mcp add …</code>, sign in with <code>/mcp</code> inside <code>claude</code>, then come back.</p>}
          {data?.servers.map((s) => (
            <label key={s.key} className="flex items-start gap-2 rounded-md border p-2 text-xs" data-testid={`mcp-found-${s.name}`}>
              <Checkbox className="mt-0.5" checked={picked.includes(s.key)} onCheckedChange={(c) => setPicked((p) => (c === true ? [...p, s.key] : p.filter((x) => x !== s.key)))} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">· {s.type} · {scopeLabel(s)}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{s.summary}</span>
                {s.secrets.length > 0 && <span className="block text-[11px] text-status-warning-ink">Moves {s.secrets.join(", ")} into the secrets store</span>}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter><Button disabled={!picked.length || busy} onClick={run} data-testid="mcp-import-run">Import {picked.length || ""}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
