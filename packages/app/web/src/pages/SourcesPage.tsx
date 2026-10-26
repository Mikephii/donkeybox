import { ShellHint } from "@/components/ShellHint";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Copy, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorList, PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { ago, useApi, useNow } from "@/lib/hooks";
import { StatusDot } from "@/app/StatusDot";
import { useCan } from "@/app/context";
import { Gate } from "@/components/Gate";
import { SecretNameField, toSecretName } from "@/components/Secrets";
import { errorsAt, Field, KeyValues, useUrlState } from "./common";

interface SourceView {
  id: string;
  source: Record<string, any>;
  kind: "webhook" | "generic" | "schedule";
  url: string | null;
  displayPath: string | null;
  emits: { exact?: string; prefix?: string; any?: boolean };
  nextRun: string | null;
  feeds: { id: string; on: string; group: string }[];
  deliveries: { n: number; ok: number; bad: number; last: string } | null;
}
interface Delivery { id: number; at: string; status: string; reason: string | null; delivery_id: string | null; event_id: number | null; event_type: string | null; test: number }

const statusDot: Record<string, string> = { accepted: "done", rejected: "failed", duplicate: "idle", ignored: "idle", failed: "failed" };

export function SourcesPage() {
  const isAdmin = useCan("admin");
  const u = useUrlState();
  const { data, reload } = useApi<SourceView[]>("/sources", ["config", "events"]);
  const selected = u.get("s") || (u.get("new") ? "" : data?.[0]?.id ?? "");
  const isNew = !!u.get("new");
  const current = data?.find((s) => s.id === selected);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader need="admin" title="Sources" description="Where events come from: webhook endpoints to paste into GitHub, Jira or CI, and schedules." subject="page:/sources">
        <Button size="sm" className="h-8 gap-1" disabled={!isAdmin} onClick={() => u.set({ new: "1", s: null })} data-testid="new-source"><Plus className="size-4" /> New source</Button>
      </PageHeader>
      <ShellHint bar>Sources are the <code>sources</code> section of the workspace's <code>config.json</code>. Add or change them in a terminal or the editor if you prefer, or ask <code>claude</code> in the shell. A broken file never takes the box down: it keeps the last good version and shows the errors.</ShellHint>
      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-80 shrink-0 border-r">
          {(data ?? []).map((s) => (
            <button key={s.id} onClick={() => u.set({ s: s.id, new: null })} data-testid={`source-row-${s.id}`}
              className={cn("block w-full border-b px-4 py-2.5 text-left", s.id === selected && !isNew ? "bg-secondary" : "hover:bg-muted/50")}>
              <div className="flex items-center gap-2 text-sm">
                {s.source.title ?? s.id}
                <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">{s.kind}</Badge>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{s.displayPath ?? s.source.schedule}</div>
              {s.deliveries && <div className="mt-0.5 text-[11px] text-muted-foreground">{s.deliveries.ok} accepted · {s.deliveries.bad} rejected</div>}
            </button>
          ))}
        </ScrollArea>
        <div className="min-w-0 flex-1">
          {isNew ? <SourceDetail key="new" view={null} onSaved={(id) => (reload(), u.set({ s: id, new: null }))} /> : current ? <SourceDetail key={current.id} view={current} onSaved={reload} onDeleted={() => (reload(), u.set({ s: null }))} /> : <p className="p-6 text-sm text-muted-foreground">No sources yet.</p>}
        </div>
      </div>
    </div>
  );
}

const VERIFIERS: { kind: string; label: string; who: string }[] = [
  { kind: "hmac", label: "Signed body (HMAC)", who: "The sender signs each body with the secret. GitHub and most SaaS webhooks work this way." },
  { kind: "header", label: "Secret in a header", who: "The sender puts the secret in a header. For your own scripts, CI and anything that lets you add headers." },
  { kind: "url-token", label: "Secret in the URL", who: "The secret is the last part of the URL. For senders that cannot sign or add headers, such as Jira Cloud system webhooks." },
  { kind: "none", label: "None", who: "Anyone who knows the URL can send events. Only for trying things out." },
];
const verifierDefaults = (kind: string, secret: string) =>
  kind === "none" ? { kind } : kind === "hmac" ? { kind, secret } : kind === "header" ? { kind, header: "X-Hook-Secret", secret } : { kind, secret };

function SourceDetail({ view, onSaved, onDeleted }: { view: SourceView | null; onSaved: (id: string) => void; onDeleted?: () => void }) {
  const [id, setId] = useState(view?.id ?? "");
  const [s, setS] = useState<Record<string, any>>(view?.source ?? { title: "", path: "/hooks/", verify: { kind: "header", header: "X-Hook-Secret", secret: "" }, map: { type: "", payload: {} } });
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(!view);
  const kind: "webhook" | "generic" | "schedule" = s.kind === "generic" ? "generic" : s.schedule !== undefined ? "schedule" : "webhook";
  const mapping = s.adapter ?? "map";
  const edit = (patch: Record<string, unknown>) => (setS((x) => ({ ...x, ...patch })), setDirty(true));
  const meta = useApi<{ hooksBase: string | null; hooksBaseFrom: string | null }>("/meta", ["config"]).data;
  const secretName = s.verify?.secret ?? "";
  const github = kind === "webhook" && s.adapter === "github";

  const setKind = (k: string) => {
    const base = { title: s.title };
    const path = s.path ?? `/hooks/${id || "new"}`;
    const verify = s.verify ?? { kind: "header", header: "X-Hook-Secret", secret: "" };
    if (k === "schedule") setS({ ...base, schedule: "0 9 * * 1-5", type: `schedule.${id || "new"}` });
    else if (k === "generic") setS({ ...base, kind: "generic", path, verify });
    else setS({ ...base, path, verify, map: { type: `${id || "new"}.event`, payload: {} } });
    setDirty(true);
  };
  const setMapping = (m: string) => {
    const { adapter: _a, map: _m, ...rest } = s;
    // GitHub can only sign bodies; switching to its adapter switches the verifier to HMAC.
    const verify = m === "github" ? { kind: "hmac", secret: rest.verify?.secret ?? "" } : rest.verify;
    setS(m === "map" ? { ...rest, verify, map: { type: `${id || "new"}.event`, payload: {} } } : { ...rest, verify, adapter: m });
    setDirty(true);
  };

  const save = async () => {
    const source = { ...s };
    for (const k of Object.keys(source)) if (source[k] === "" || source[k] === undefined) delete source[k];
    try {
      await api(`/sources/${id}`, { method: "PUT", body: { source } });
      setErrors([]);
      setDirty(false);
      toast.success(`Saved source ${id}`);
      onSaved(id);
    } catch (e) {
      setErrors(e instanceof ApiError && e.details.length ? e.details : [(e as Error).message]);
    }
  };
  const remove = async () => {
    try {
      await api(`/sources/${view!.id}`, { method: "DELETE" });
      toast.success(`Deleted ${view!.id}`);
      onDeleted?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const shownPath = s.path ? (s.verify?.kind === "url-token" ? `${s.path.replace(/\/+$/, "")}/<token>` : s.path) : null;
  const fullUrl = view?.url ?? (shownPath && meta?.hooksBase ? `${meta.hooksBase}${shownPath}` : null);
  const realUrl = (token: string) => (s.path && meta?.hooksBase ? `${meta.hooksBase}${s.path.replace(/\/+$/, "")}/${token}` : `${s.path}/${token}`);
  const v = s.verify ?? {};

  const pasteHint = github ? (
    <>GitHub › repository or organisation Settings › Webhooks › Add webhook: this URL, content type <code>application/json</code>, and the value of <code>{secretName || "the secret"}</code> as the secret.</>
  ) : v.kind === "url-token" ? (
    <>Paste the whole URL with the secret's value in place of <code>&lt;token&gt;</code>. It was shown once when you generated it; rotate the secret to get a new one.{s.adapter === "jira" && <> In Jira: System › WebHooks › Create a WebHook.</>}</>
  ) : v.kind === "header" ? (
    <>The sender must send header <code>{v.header}</code> with the value of <code>{secretName || "the secret"}</code>.</>
  ) : v.kind === "hmac" ? (
    <>The sender signs the body with <code>{secretName || "the secret"}</code> ({v.algorithm ?? "sha256"}) and sends it in <code>{v.header ?? "x-hub-signature-256"}</code>.</>
  ) : (
    <>No check: anyone with the URL can send events.</>
  );

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-3xl gap-5 p-6" data-testid={`source-detail-${view?.id ?? "new"}`}>
        {view && kind !== "schedule" && !fullUrl && (
          <div className="grid gap-1.5" data-testid="source-url-unset">
            <div className="text-xs font-medium">Webhook path</div>
            <code className="rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="source-path-only">{shownPath}</code>
            <p className="text-[11px] text-muted-foreground">
              The base URL is set by you in Settings; the workbench cannot see its own public address. <Link to="/settings" className="underline" data-testid="source-settings-link">Set it in Settings</Link>.
            </p>
          </div>
        )}
        {view && kind !== "schedule" && fullUrl && (
          <div className="grid gap-1.5">
            <div className="text-xs font-medium">Webhook URL</div>
            <div className="flex gap-2">
              <code className="flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="source-url">{fullUrl}</code>
              <Button variant="outline" size="sm" className="h-auto gap-1" onClick={() => (navigator.clipboard.writeText(fullUrl), toast.success("Copied"))}><Copy className="size-3.5" /> Copy</Button>
            </div>
            <p className="text-[11px] text-muted-foreground" data-testid="source-paste-hint">{pasteHint} Emits <code>{view.emits.exact ?? (view.emits.prefix ? `${view.emits.prefix}*` : "whatever type the sender names")}</code>.</p>
          </div>
        )}
        {kind === "generic" && (
          <div className="grid gap-1.5 rounded-md border bg-muted/30 p-3 text-xs" data-testid="generic-example">
            <div className="font-medium">Sending to a generic source</div>
            <p className="text-muted-foreground">Post JSON with a <code>type</code> (letters, digits, dots and dashes), an optional <code>summary</code>, <code>payload</code> object and <code>actor</code>. The event is taken as sent; rules match on its type.</p>
            <pre className="overflow-auto rounded border bg-background p-2 text-[11px]">{`curl -X POST ${fullUrl ?? `<base URL>${shownPath ?? "/hooks/…"}`} \\
  -H 'content-type: application/json' \\${v.kind === "header" ? `\n  -H '${v.header}: <the secret>' \\` : ""}
  -d '{"type":"ci.build.failed","summary":"main is red","payload":{"sha":"abc123"}}'`}</pre>
          </div>
        )}
        {view?.nextRun && <p className="text-sm">Next run: <span className="font-medium">{new Date(view.nextRun).toLocaleString()}</span> (emits <code>{view.emits.exact}</code>)</p>}
        {view && (
          <div className="text-xs text-muted-foreground">
            Feeds {view.feeds.length ? view.feeds.map((f, i) => <span key={f.id}>{i ? ", " : ""}<Link to={`/workflows/${f.group}?tab=rules`} className="underline">{f.id}</Link> ({f.group})</span>) : "no rules yet"}.
          </div>
        )}

        <Gate need="admin"><section className="grid gap-4 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="ID" hint={view ? undefined : "Lowercase letters, digits and dashes."} errors={errorsAt(errors, "id")}>
              <Input value={id} disabled={!!view} onChange={(e) => setId(e.target.value)} className="font-mono" data-testid="source-id" />
            </Field>
            <Field label="Title" errors={errorsAt(errors, "source.title")}><Input value={s.title ?? ""} onChange={(e) => edit({ title: e.target.value })} data-testid="source-title" /></Field>
          </div>
          <Field label="Kind" hint={kind === "webhook" ? "A known sender (GitHub, Jira) or any JSON turned into an event by a map." : kind === "generic" ? "Your own scripts and CI: they send the event itself." : "Fires on a cron schedule."}>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger data-testid="source-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="webhook">Webhook from a service</SelectItem>
                <SelectItem value="generic">Generic event (your scripts, CI)</SelectItem>
                <SelectItem value="schedule">Schedule</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {kind === "schedule" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Cron" hint="minute hour day month weekday, in the time zone from Settings" errors={errorsAt(errors, "source.schedule")}><Input value={s.schedule ?? ""} onChange={(e) => edit({ schedule: e.target.value })} className="font-mono" /></Field>
              <Field label="Event type it emits" errors={errorsAt(errors, "source.type")}><Input value={s.type ?? ""} onChange={(e) => edit({ type: e.target.value })} className="font-mono" /></Field>
              <Field label="Payload" className="col-span-2"><KeyValues value={s.payload ?? {}} onChange={(val) => edit({ payload: val })} /></Field>
            </div>
          ) : (
            <>
              <Field label="Path" errors={errorsAt(errors, "source.path")}><Input value={s.path ?? ""} onChange={(e) => edit({ path: e.target.value })} className="font-mono" data-testid="source-path" /></Field>
              {kind === "webhook" && (
                <Field label="Turn the body into an event with">
                  <Select value={mapping} onValueChange={setMapping}>
                    <SelectTrigger data-testid="source-mapping"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="github">GitHub adapter</SelectItem><SelectItem value="jira">Jira adapter</SelectItem><SelectItem value="map">A declarative map</SelectItem></SelectContent>
                  </Select>
                </Field>
              )}
              <div className="grid gap-3 rounded-md border p-3" data-testid="source-verifier">
                <Field label="How the sender proves it is genuine" errors={errorsAt(errors, "source.verify").filter((e) => !/secret/.test(e))}>
                  <Select value={v.kind ?? "header"} disabled={github} onValueChange={(k) => edit({ verify: verifierDefaults(k, v.secret ?? "") })}>
                    <SelectTrigger data-testid="source-verify-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>{VERIFIERS.map((x) => <SelectItem key={x.kind} value={x.kind}>{x.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <p className="text-[11px] text-muted-foreground" data-testid="source-verify-who">{VERIFIERS.find((x) => x.kind === (v.kind ?? "header"))?.who}</p>
                {github && (
                  <p className="rounded-md border bg-muted/40 p-2 text-[11px]" data-testid="source-github-hmac">
                    GitHub cannot be moved off HMAC: it signs every delivery with the secret and has no way to send a fixed header or put a token in the URL.
                  </p>
                )}
                {v.kind === "none" && (
                  <p className="rounded-md border border-status-warning/50 bg-status-warning-subtle p-2 text-[11px] text-status-warning-ink" data-testid="source-none-warning">
                    Anyone who finds this URL can start runs. Use it only while trying things out, then pick a verifier.
                  </p>
                )}
                {v.kind === "header" && (
                  <Field label="Header" errors={errorsAt(errors, "source.verify.header")}><Input value={v.header ?? ""} onChange={(e) => edit({ verify: { ...v, header: e.target.value } })} className="h-8 font-mono text-xs" data-testid="source-verify-header" /></Field>
                )}
                {v.kind === "hmac" && !github && (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Signature header"><Input value={v.header ?? ""} placeholder="x-hub-signature-256" onChange={(e) => edit({ verify: { ...v, header: e.target.value || undefined } })} className="h-8 font-mono text-xs" /></Field>
                    <Field label="Algorithm">
                      <Select value={v.algorithm ?? "sha256"} onValueChange={(a) => edit({ verify: { ...v, algorithm: a === "sha256" ? undefined : a } })}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="sha256">sha256</SelectItem><SelectItem value="sha1">sha1</SelectItem></SelectContent>
                      </Select>
                    </Field>
                    <Field label="Prefix"><Input value={v.prefix ?? ""} placeholder="sha256=" onChange={(e) => edit({ verify: { ...v, prefix: e.target.value } })} className="h-8 font-mono text-xs" /></Field>
                  </div>
                )}
                {v.kind && v.kind !== "none" && (
                  <Field label="Secret" hint="A name from the Secrets page, never the value. Generate makes one and shows it once." errors={errorsAt(errors, "source.verify.secret")}>
                    <SecretNameField value={secretName} onChange={(name) => edit({ verify: { ...v, secret: name } })} suggest={toSecretName(`${id || "hook"}_secret`)} testid="source-secret"
                      reveal={v.kind === "url-token" ? (value) => ({ label: "The URL to paste, with the token", value: realUrl(value) }) : undefined} />
                  </Field>
                )}
              </div>
              {kind === "webhook" && mapping === "map" && s.map && (
                <div className="grid gap-3 rounded-md border p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Event type" errors={errorsAt(errors, "source.map.type")}><Input value={s.map.type ?? ""} onChange={(e) => edit({ map: { ...s.map, type: e.target.value } })} className="font-mono text-xs" data-testid="source-map-type" /></Field>
                    <Field label="Summary (optional)" hint="{{payload.x}} fills in."><Input value={s.map.summary ?? ""} onChange={(e) => edit({ map: { ...s.map, summary: e.target.value || undefined } })} className="text-xs" /></Field>
                  </div>
                  <Field label="Payload fields" hint="Each value is a path into the body, like $.environment."><KeyValues value={s.map.payload ?? {}} onChange={(val) => edit({ map: { ...s.map, payload: val } })} keyPlaceholder="env" valuePlaceholder="$.environment" /></Field>
                </div>
              )}
            </>
          )}
          <ErrorList errors={errors.filter((e) => !/^(source\.(title|schedule|type|path|verify|map)|id)[.:]/.test(e))} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!dirty || !id} onClick={save} data-testid="source-save">{view ? "Save source" : "Create source"}</Button>
            {view && <Button size="sm" variant="ghost" className="ml-auto gap-1 text-status-critical-ink" onClick={remove} data-testid="source-delete"><Trash2 className="size-4" /> Delete</Button>}
          </div>
        </section></Gate>

        {view && kind !== "schedule" && <Gate need="admin"><TestAndDeliveries id={view.id} /></Gate>}
      </div>
    </ScrollArea>
  );
}

function TestAndDeliveries({ id }: { id: string }) {
  const [triggerRules, setTriggerRules] = useState(false);
  const [result, setResult] = useState<{ status: number; body: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: deliveries, reload } = useApi<Delivery[]>(`/sources/${id}/deliveries?limit=25`, ["events"], 10_000);
  const now = useNow(10_000);
  useEffect(() => setResult(null), [id]);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: number; body: unknown }>(`/sources/${id}/test`, { body: { triggerRules } });
      setResult(r);
      setTimeout(reload, 400);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={send} data-testid="source-test"><Send className="size-3.5" /> Send a test delivery</Button>
        <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={triggerRules} onCheckedChange={(c) => setTriggerRules(c === true)} data-testid="source-test-rules" /> Also run matching rules (starts real runs)</label>
      </div>
      <p className="text-[11px] text-muted-foreground">The test is signed exactly like a real sender and goes through the webhook listener, so it checks the secret, the verifier and the mapping.</p>
      {result && <pre className="overflow-auto rounded-md border bg-muted/40 p-2 text-[11px]" data-testid="source-test-result">HTTP {result.status} {JSON.stringify(result.body)}</pre>}
      <div className="text-xs font-medium">Recent deliveries</div>
      <div className="rounded-md border" data-testid="source-deliveries">
        {(deliveries ?? []).length === 0 && <p className="p-3 text-xs text-muted-foreground">None yet.</p>}
        {(deliveries ?? []).map((d) => (
          <div key={d.id} className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
            <StatusDot status={statusDot[d.status] ?? "unknown"} />
            <span className="w-20 font-medium">{d.status}</span>
            {d.test ? <Badge variant="outline" className="h-4 px-1 text-[10px]">test</Badge> : null}
            <span className="truncate text-muted-foreground">{d.event_type ?? ""} {d.reason ?? ""}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{ago(d.at, now)} ago</span>
          </div>
        ))}
      </div>
    </section>
  );
}
