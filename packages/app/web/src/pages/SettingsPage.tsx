import { Link } from "react-router";
import { ShellHint } from "@/components/ShellHint";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, KeyRound, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ErrorList, PageHeader } from "@/components/PageHeader";
import { api, ApiError } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { useMe } from "@/app/context";
import { SecretNameField } from "@/components/Secrets";
import { Gate } from "@/components/Gate";
import { errorsAt, Field, StringList, useUrlState } from "./common";

type Obj = Record<string, any>;
export interface SettingsView {
  settings: Obj;
  effective: Obj;
  hooksBase: string | null;
  hooksBaseFrom: "settings" | "default" | null;
  deployKey: string | null;
  workspace: { remote: string | null; branch: string; head: string; ahead: number; behind: number; diverged: boolean; uncommitted: boolean; lastPullAt: string | null; lastPushAt: string | null; lastError: string | null } | null;
}

const getIn = (o: Obj, path: string) => path.split(".").reduce<any>((x, k) => (x == null ? undefined : x[k]), o);
/** Sets a nested value; empty strings and undefined remove the key so defaults stay defaults. */
function setIn(o: Obj, path: string, v: unknown): Obj {
  const [k, ...rest] = path.split(".");
  const next = { ...o };
  if (rest.length) {
    const child = setIn(next[k!] ?? {}, rest.join("."), v);
    if (Object.keys(child).length) next[k!] = child;
    else delete next[k!];
  } else if (v === "" || v === undefined) delete next[k!];
  else next[k!] = v;
  return next;
}
const MODELS = ["sonnet", "opus", "haiku", "fable"];
const zones = (() => {
  try {
    return (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    return [];
  }
})();

export function SettingsPage() {
  const { data, reload } = useApi<SettingsView>("/settings", ["config"]);
  const me = useMe();
  const u = useUrlState();
  const tab = u.get("tab") || "general";
  const [s, setS] = useState<Obj | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [json, setJson] = useState("");
  useEffect(() => {
    if (data && !dirty) {
      setS(data.settings);
      setJson(JSON.stringify(data.settings, null, 2));
    }
  }, [data, dirty]);
  if (!data || !s) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const eff = data.effective;
  const canEdit = me?.role ? me.role === "admin" : true;
  const err = (path: string) => errorsAt(errors.map((e) => e.replace(/^settings\./, "")), path);
  const val = (path: string) => getIn(s, path) ?? "";
  const set = (path: string, v: unknown) => {
    setS((x) => {
      const n = setIn(x ?? {}, path, v);
      setJson(JSON.stringify(n, null, 2));
      return n;
    });
    setDirty(true);
  };
  const num = (path: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(path, e.target.value === "" ? undefined : Number(e.target.value));

  const save = async (value: Obj) => {
    try {
      await api("/settings", { method: "PUT", body: { value } });
      setErrors([]);
      setDirty(false);
      toast.success("Settings saved to config.json");
      reload();
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    }
  };
  const saveJson = () => {
    try {
      void save(JSON.parse(json));
    } catch (e) {
      setErrors([`JSON: ${(e as Error).message}`]);
    }
  };
  const discard = () => (setDirty(false), setErrors([]), reload());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader need="admin" title="Settings" description="Box-wide settings, stored in the settings section of the workspace's config.json." subject="page:/settings">
        <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" asChild><Link to="/design" data-testid="design-link">Design system</Link></Button>
        {dirty && <Button size="sm" variant="ghost" className="h-8" onClick={discard}>Discard</Button>}
        <Button size="sm" className="h-8" disabled={!dirty || !canEdit} onClick={() => (tab === "json" ? saveJson() : save(s))} data-testid="settings-save">Save settings</Button>
      </PageHeader>
      <ShellHint bar>These are the <code>settings</code> section of the workspace's <code>config.json</code>; edit the file directly if you prefer. The box itself is an ordinary machine: install tools, change dotfiles or run your own services from a terminal.</ShellHint>
      <Tabs value={tab} onValueChange={(t) => u.set({ tab: t === "general" ? null : t })} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="mx-auto w-full max-w-3xl px-6 pt-3"><TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="workspace" data-testid="settings-tab-workspace">Box config repo</TabsTrigger>
          <TabsTrigger value="access" data-testid="settings-tab-access">People</TabsTrigger>
          <TabsTrigger value="doors">Doors and sign-in</TabsTrigger>
          <TabsTrigger value="limits">Limits</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList></div>
        <ScrollArea className="min-h-0 flex-1">
          <Gate need="admin">
          <div className="mx-auto grid max-w-3xl gap-5 p-6">
            <ErrorList errors={errors} strip="settings." />
            {!canEdit && <p className="rounded-md border bg-muted/40 p-3 text-xs">Only admins can change settings. You can read them.</p>}

            <TabsContent value="general" className="grid gap-5">
              <Section title="This box">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name" hint="Shown in the sidebar and in page titles." errors={err("box.name")}>
                    <Input value={val("box.name")} placeholder={eff.box.name} onChange={(e) => set("box.name", e.target.value)} data-testid="settings-box-name" />
                  </Field>
                  <Field label="Box id" hint="Assigned on first start. Never changes.">
                    <Input value={eff.box.id ?? ""} disabled className="font-mono text-xs" />
                  </Field>
                </div>
              </Section>
              <Section title="Public addresses" description="The workbench cannot see its own public address, so you tell it here. Deployments fill these in on first boot.">
                <Field label="Webhook base URL" errors={err("publicHooksUrl")}
                  hint={<>Webhook URLs on the Sources page are this plus the source's path. {data.hooksBaseFrom === "default" && <>Until you set it, they use <code>{data.hooksBase}</code>, which only works on this machine.</>}</>}>
                  <Input value={val("publicHooksUrl")} placeholder={data.hooksBaseFrom === "default" ? data.hooksBase ?? "" : "https://hooks.example.com"} onChange={(e) => set("publicHooksUrl", e.target.value)} className="font-mono text-xs" data-testid="settings-hooks-url" />
                </Field>
                <Field label="App URL" hint="The address people open. Used in links and for the sign-in callback in OIDC mode." errors={err("publicAppUrl")}>
                  <Input value={val("publicAppUrl")} placeholder="https://workbench.example.com" onChange={(e) => set("publicAppUrl", e.target.value)} className="font-mono text-xs" data-testid="settings-app-url" />
                </Field>
              </Section>
              <Section title="Runs">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Default model" hint="Used when a workflow does not pick one. Empty means Claude Code's own default." errors={err("defaultModel")}>
                    <Input list="wb-models" value={val("defaultModel")} placeholder="Claude Code default" onChange={(e) => set("defaultModel", e.target.value)} className="font-mono text-xs" data-testid="settings-model" />
                    <datalist id="wb-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
                  </Field>
                  <Field label="Keep finished run sessions for (hours)" hint="Their terminals are deleted after this. Transcripts and history stay." errors={err("sessionRetentionHours")}>
                    <Input type="number" min={0} value={val("sessionRetentionHours")} placeholder={String(eff.sessionRetentionHours)} onChange={num("sessionRetentionHours")} data-testid="settings-retention" />
                  </Field>
                  <Field label="Time zone for schedules" hint="Cron schedules on the Sources page run in this zone. Empty means the box's zone." errors={err("timezone")}>
                    <Input list="wb-zones" value={val("timezone")} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(e) => set("timezone", e.target.value)} className="font-mono text-xs" data-testid="settings-timezone" />
                    <datalist id="wb-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
                  </Field>
                  <Field label="Skills folder" hint="Relative to the workspace. Workflows' skills are read and written here." errors={err("skillsDir")}>
                    <Input value={val("skillsDir")} placeholder={eff.skillsDir} onChange={(e) => set("skillsDir", e.target.value)} className="font-mono text-xs" data-testid="settings-skills-dir" />
                  </Field>
                </div>
              </Section>
              <Section title="Schedules" description="Internal: this box fires its own cron schedules. External: a scheduler outside calls the box, so the box can sleep between runs.">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Who fires schedules">
                    <Select value={getIn(s, "scheduler.mode") ?? eff.scheduler.mode} onValueChange={(v) => set("scheduler.mode", v === "internal" ? undefined : v)}>
                      <SelectTrigger data-testid="settings-scheduler"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="internal">This box (internal)</SelectItem><SelectItem value="external">An outside scheduler (external)</SelectItem></SelectContent>
                    </Select>
                  </Field>
                  <Field label="Secret the scheduler sends" hint={<>A name from the Secrets page. The scheduler posts to <code>/hooks/_schedule/&lt;source&gt;</code> with it in <code>X-Workbench-Schedule-Secret</code>.</>} errors={err("scheduler.secret")}>
                    <SecretNameField value={val("scheduler.secret")} suggest={eff.scheduler.secret} onChange={(v) => set("scheduler.secret", v)} hint="Give it to the outside scheduler." />
                  </Field>
                </div>
              </Section>
              <Section title="Editor">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={getIn(s, "codeServer") ?? eff.codeServer} onCheckedChange={(c) => set("codeServer", c === true ? true : undefined)} data-testid="settings-code-server" />
                  Run code-server on this box (a browser VS Code at <code>/code</code>, opened from Code windows)
                </label>
                <p className="text-[11px] text-muted-foreground">It must be installed first with <code>wb tools install code-server</code>. The Services page shows whether it is.</p>
              </Section>
            </TabsContent>


            <TabsContent value="workspace" className="grid gap-5">
              <WorkspaceSection view={data} remote={val("workspaceRemote")} onRemote={(v) => set("workspaceRemote", v)} errors={err("workspaceRemote")} onChanged={reload} />
            </TabsContent>

            <TabsContent value="access" className="grid gap-5">
              <Section title="People" description="Who may use this box and what they may do. Admins change settings, secrets and access. Members build workflows and run agents. Viewers watch.">
                <UsersEditor value={getIn(s, "access.users") ?? []} onChange={(v) => set("access.users", v.length ? v : undefined)} errors={err("access.users")} />
              </Section>
              <Section title="Whole domains">
                <Field label="Anyone with an email at these domains gets the default role" hint="For example example.com. Leave empty to allow only the people above." errors={err("access.domains")}>
                  <StringList value={getIn(s, "access.domains") ?? []} onChange={(v) => set("access.domains", v.length ? v : undefined)} placeholder="example.com" testid="settings-domains" />
                </Field>
                <Field label="Default role" hint="For domain matches, and for everyone the door lets in when no list is set." errors={err("access.defaultRole")}>
                  <RoleSelect value={getIn(s, "access.defaultRole") ?? eff.access.defaultRole} onChange={(v) => set("access.defaultRole", v === "member" ? undefined : v)} />
                </Field>
              </Section>
            </TabsContent>

            <TabsContent value="doors" className="grid gap-5">
              <Section title="Doors" description="The app door is where people sign in; the hooks door only accepts webhooks. Host names are used to route each door when both share an address.">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="App host names" errors={err("doors.appHosts")}><StringList value={getIn(s, "doors.appHosts") ?? []} onChange={(v) => set("doors.appHosts", v.length ? v : undefined)} placeholder="workbench.example.com" /></Field>
                  <Field label="Hooks host names" errors={err("doors.hooksHosts")}><StringList value={getIn(s, "doors.hooksHosts") ?? []} onChange={(v) => set("doors.hooksHosts", v.length ? v : undefined)} placeholder="hooks.example.com" /></Field>
                  <Field label="Who can reach the app door" hint="Private limits it to the networks below; sign-in is still required either way.">
                    <Select value={getIn(s, "doors.appAccess") ?? eff.doors.appAccess} onValueChange={(v) => set("doors.appAccess", v === "public" ? undefined : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="public">Any network</SelectItem><SelectItem value="private">Private networks only</SelectItem><SelectItem value="both">Private networks and the sign-in proxy</SelectItem></SelectContent>
                    </Select>
                  </Field>
                  <Field label="Private networks (CIDR)" errors={err("doors.privateCidrs")}><StringList value={getIn(s, "doors.privateCidrs") ?? eff.doors.privateCidrs} onChange={(v) => set("doors.privateCidrs", v)} placeholder="10.0.0.0/8" /></Field>
                </div>
              </Section>
              <Section title="Sign-in" description={<>The sign-in mode is <code>{me?.authMode ?? "set by the deployment"}</code> and comes from the box's <code>AUTH_MODE</code> variable, so a change to this file can never turn sign-in off. These settings tune the proxy and OIDC modes.</>}>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Proxy: email header" errors={err("auth.proxy.emailHeader")}><Input value={val("auth.proxy.emailHeader")} placeholder={eff.auth.proxy.emailHeader} onChange={(e) => set("auth.proxy.emailHeader", e.target.value)} className="font-mono text-xs" /></Field>
                  <Field label="Proxy: name header (optional)" errors={err("auth.proxy.nameHeader")}><Input value={val("auth.proxy.nameHeader")} placeholder="X-Forwarded-User" onChange={(e) => set("auth.proxy.nameHeader", e.target.value)} className="font-mono text-xs" /></Field>
                  <Field label="Proxy: shared secret name" hint={<>The proxy sends it in <code>X-Workbench-Proxy-Secret</code>. A name from the Secrets page.</>} errors={err("auth.proxy.secret")}><SecretNameField value={val("auth.proxy.secret")} suggest={eff.auth.proxy.secret} onChange={(v) => set("auth.proxy.secret", v)} hint="Give it to the proxy, which sends it on every request." /></Field>
                  <Field label="Proxy: trusted networks (CIDR)" hint="Requests from elsewhere are refused even with the header." errors={err("auth.proxy.trustedCidrs")}><StringList value={getIn(s, "auth.proxy.trustedCidrs") ?? []} onChange={(v) => set("auth.proxy.trustedCidrs", v.length ? v : undefined)} placeholder="172.18.0.0/16" /></Field>
                  <Field label="OIDC: issuer" errors={err("auth.oidc.issuer")}><Input value={val("auth.oidc.issuer")} placeholder="https://accounts.example.com" onChange={(e) => set("auth.oidc.issuer", e.target.value)} className="font-mono text-xs" /></Field>
                  <Field label="OIDC: client id" errors={err("auth.oidc.clientId")}><Input value={val("auth.oidc.clientId")} onChange={(e) => set("auth.oidc.clientId", e.target.value)} className="font-mono text-xs" /></Field>
                  <Field label="OIDC: client secret name" hint="A name from the Secrets page." errors={err("auth.oidc.clientSecret")}><SecretNameField value={val("auth.oidc.clientSecret")} suggest={eff.auth.oidc.clientSecret} onChange={(v) => set("auth.oidc.clientSecret", v)} canGenerate={false} /></Field>
                  <Field label="OIDC: stay signed in for (hours)" errors={err("auth.oidc.sessionHours")}><Input type="number" value={val("auth.oidc.sessionHours")} placeholder={String(eff.auth.oidc.sessionHours)} onChange={num("auth.oidc.sessionHours")} /></Field>
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="limits" className="grid gap-5">
              <Section title="Limits" description="Guard rails for a shared box. New runs wait in the queue when the box is at its limit.">
                <div className="grid grid-cols-2 gap-4">
                  {([
                    ["maxConcurrentRuns", "Runs at once", "Further runs queue."],
                    ["maxRunSessionHours", "Longest a run may keep its session (hours)", "Older live runs are stopped."],
                    ["maxTerminals", "Terminals people may open", "Standing and run sessions do not count."],
                    ["diskWarnPercent", "Warn when the data disk is this full (%)", "A banner appears for everyone."],
                    ["diskStopPercent", "Stop starting runs at (%)", "Runs already going carry on."],
                  ] as const).map(([k, label, hint]) => (
                    <Field key={k} label={label} hint={hint} errors={err(`limits.${k}`)}>
                      <Input type="number" value={val(`limits.${k}`)} placeholder={String(eff.limits[k])} onChange={num(`limits.${k}`)} data-testid={`settings-limit-${k}`} />
                    </Field>
                  ))}
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="json" className="grid gap-2">
              <p className="text-xs text-muted-foreground">The <code>settings</code> section exactly as stored. Defaults that are not written here still apply. The server validates it before writing.</p>
              <Textarea value={json} onChange={(e) => (setJson(e.target.value), setDirty(true))} className="min-h-[480px] font-mono text-xs" data-testid="settings-json" />
            </TabsContent>
          </div>
          </Gate>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function RoleSelect({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-32" data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent>
    </Select>
  );
}

function UsersEditor({ value, onChange, errors }: { value: { email: string; role: string }[]; onChange: (v: { email: string; role: string }[]) => void; errors: string[] }) {
  return (
    <div className="grid gap-1.5" data-testid="settings-users">
      {value.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <Input className="h-8 text-xs" value={p.email} placeholder="person@example.com" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
          <RoleSelect value={p.role} onChange={(r) => onChange(value.map((x, j) => (j === i ? { ...x, role: r } : x)))} />
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove"><X className="size-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs" onClick={() => onChange([...value, { email: "", role: "member" }])} data-testid="settings-add-user"><Plus className="size-3.5" /> Add person</Button>
      {errors.map((e, i) => <p key={i} className="text-[11px] text-status-critical-ink">{e}</p>)}
    </div>
  );
}

function WorkspaceSection({ view, remote, onRemote, errors, onChanged }: { view: SettingsView; remote: string; onRemote: (v: string) => void; errors: string[]; onChanged: () => void }) {
  const ws = view.workspace;
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const key = view.deployKey;
  const isSsh = /^(git@|ssh:\/\/)/.test(remote);
  const sync = async () => {
    setBusy(true);
    try {
      await api("/workspace/sync", { method: "POST" });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const makeKey = async () => {
    await api("/keys/deploy", { method: "POST" });
    onChanged();
  };
  const state = useMemo(() => {
    if (!ws) return "No workspace state.";
    if (ws.diverged) return "Diverged: the remote and this box both have commits the other lacks. Saves pause until a person merges.";
    if (!ws.remote) return "No remote yet. Every save is committed here only.";
    return `${ws.ahead ? `${ws.ahead} to push` : "Nothing to push"} · ${ws.behind ? `${ws.behind} to pull` : "up to date"}`;
  }, [ws]);
  return (
    <>
      <Section title="The box's config repo" description="This is the workspace: the box's own config.json, workflow skills and scripts. It is not your code and the workbench never touches your code repos. Every save from these pages is a commit here with your name; agents that edit it are told to commit too. A remote keeps it off the box and lets people edit it from a laptop.">
        <Field label="Remote for the box's config" hint="A repo of its own for the box's settings, e.g. your-org/workbench-config. Use an SSH URL with this box's deploy key, or an https URL with credentials git already has. Pushes happen a few seconds after each save; pulls are fast-forward only, every five minutes." errors={errors}>
          <Input value={remote} placeholder="git@github.com:your-org/workbench-config.git" onChange={(e) => onRemote(e.target.value)} className="font-mono text-xs" data-testid="settings-remote" />
        </Field>
        {ws && (
          <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-xs" data-testid="workspace-state">
            <div><span className="text-muted-foreground">Branch</span> {ws.branch} at <code>{ws.head}</code></div>
            <div>{state}</div>
            {ws.lastPullAt && <div className="text-muted-foreground">Last pull {ago(ws.lastPullAt, now)} ago{ws.lastPushAt ? ` · last push ${ago(ws.lastPushAt, now)} ago` : ""}</div>}
            {ws.lastError && <div className="text-status-critical-ink">{ws.lastError}</div>}
            <Button size="sm" variant="outline" className="mt-1 h-7 w-fit gap-1 text-xs" disabled={busy || !ws.remote} onClick={sync} data-testid="workspace-sync"><RefreshCw className="size-3.5" /> Sync now</Button>
          </div>
        )}
      </Section>
      <Section title="Deploy key for the config repo" description="An SSH key for pushing the box's config. Add the public half as a deploy key with write access on the config repo only. How agents reach your code repos is up to you and your skills.">
        {key ? (
          <>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-md border bg-muted/40 px-3 py-2 text-[11px]" data-testid="deploy-key">{key}</code>
              <Button variant="outline" size="sm" className="h-auto gap-1" onClick={() => (navigator.clipboard.writeText(key), toast.success("Copied"))}><Copy className="size-3.5" /> Copy</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">GitHub: the repository's Settings › Deploy keys › Add deploy key, tick "Allow write access" on the config repo.{isSsh ? "" : " Set an SSH remote above to use it."}</p>
          </>
        ) : (
          <Button size="sm" variant="outline" className="w-fit gap-1" onClick={makeKey} data-testid="deploy-key-create"><KeyRound className="size-3.5" /> Create the deploy key</Button>
        )}
      </Section>
    </>
  );
}
