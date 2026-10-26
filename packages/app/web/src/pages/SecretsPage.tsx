import { ShellHint } from "@/components/ShellHint";
import { useState } from "react";
import { Link } from "react-router";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/PageHeader";
import { OnceDialog, SECRET_NAME, SecretState, useSecrets, type SecretRow } from "@/components/Secrets";
import { api } from "@/lib/api";
import { ago, useNow } from "@/lib/hooks";
import { useMe } from "@/app/context";

type Edit = { mode: "create" | "rotate"; name: string; value: string; generate: boolean } | null;

export function SecretsPage() {
  const { data, reload } = useSecrets();
  const me = useMe();
  const canEdit = me?.role ? me.role === "admin" : true;
  const now = useNow(60_000);
  const [edit, setEdit] = useState<Edit>(null);
  const [shown, setShown] = useState<{ name: string; value: string } | null>(null);
  const [del, setDel] = useState<SecretRow | null>(null);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!edit) return;
    setError("");
    try {
      const body = edit.generate ? { generate: true } : { value: edit.value };
      const r = edit.mode === "create" ? await api<{ name: string; value?: string }>("/secrets", { body: { name: edit.name, ...body } }) : await api<{ name: string; value?: string }>(`/secrets/${edit.name}/rotate`, { body });
      setEdit(null);
      if (r.value) setShown({ name: r.name, value: r.value });
      else toast.success(edit.mode === "create" ? `Stored ${r.name}` : `Rotated ${r.name}`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    try {
      await api(`/secrets/${del!.name}`, { method: "DELETE" });
      toast.success(`Deleted ${del!.name}`);
      setDel(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const where = data?.backend === "gcp" ? "Google Secret Manager" : "a file in the data folder that only the workbench user can read";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader need="admin" title="Secrets" description="Webhook secrets, tokens for MCP servers and repos, and sign-in secrets. Referenced by name; values never leave the box after you set them." subject="page:/secrets">
        <Button size="sm" className="h-8 gap-1" disabled={!canEdit} onClick={() => (setError(""), setEdit({ mode: "create", name: "", value: "", generate: true }))} data-testid="secret-new"><Plus className="size-4" /> New secret</Button>
      </PageHeader>
      <ShellHint bar>From a terminal: <code>wb secrets set NAME</code> (reads the value from stdin), <code>wb secrets generate NAME</code>, <code>wb secrets</code> to list. An environment variable with the same name works too, so <code>.env</code> files and your host's secret settings are fine.</ShellHint>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid max-w-4xl gap-4 p-6">
          <p className="text-xs text-muted-foreground">
            Values are kept in {where}. A name that is not in the store falls back to an environment variable of the same name, which is how
            <code> .env</code> and container settings still work. Config refers to secrets by name: a source's verifier, <code>{"${secret:NAME}"}</code> in an MCP server's
            environment or headers, a repo's token, and the sign-in settings.
          </p>
          <div className="rounded-lg border" data-testid="secrets-table">
            <div className="grid grid-cols-[1.3fr_7rem_1.7fr_8rem_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium text-muted-foreground">
              <span>Name</span><span>State</span><span>Used by</span><span>Changed</span><span />
            </div>
            {(data?.secrets ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No secrets yet.</p>}
            {(data?.secrets ?? []).map((s) => (
              <div key={s.name} className="grid grid-cols-[1.3fr_7rem_1.7fr_8rem_auto] items-center gap-3 border-b px-4 py-2 text-xs last:border-b-0" data-testid={`secret-row-${s.name}`}>
                <code className="truncate font-medium">{s.name}</code>
                <span><SecretState row={s} /></span>
                <span className="truncate text-muted-foreground">
                  {s.usedBy.length ? s.usedBy.map((u, i) => <span key={i}>{i ? ", " : ""}<Link to={u.link} className="underline">{u.where}</Link></span>) : "not used"}
                </span>
                <span className="text-muted-foreground">{s.updatedAt ? `${ago(s.updatedAt, now)} ago` : "—"}</span>
                <span className="flex justify-end gap-1">
                  {s.from === "store" ? (
                    <>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={!canEdit} onClick={() => (setError(""), setEdit({ mode: "rotate", name: s.name, value: "", generate: true }))} data-testid={`secret-rotate-${s.name}`}><RotateCw className="size-3.5" /> Rotate</Button>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-status-critical-ink" disabled={!canEdit} onClick={() => setDel(s)} data-testid={`secret-delete-${s.name}`}><Trash2 className="size-3.5" /> Delete</Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!canEdit} onClick={() => (setError(""), setEdit({ mode: "create", name: s.name, value: "", generate: false }))} data-testid={`secret-set-${s.name}`}>Store a value</Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent data-testid="secret-dialog">
          <DialogHeader>
            <DialogTitle>{edit?.mode === "rotate" ? `Rotate ${edit.name}` : "New secret"}</DialogTitle>
            <DialogDescription>{edit?.mode === "rotate" ? "The old value stops working as soon as you save. Update the sender straight after." : "Generate one for a webhook you configure in the sender, or paste a token a vendor gave you."}</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="grid gap-3">
              {edit.mode === "create" && (
                <div className="grid gap-1">
                  <Input value={edit.name} placeholder="JIRA_HOOK_SECRET" onChange={(e) => setEdit({ ...edit, name: e.target.value.toUpperCase() })} className="font-mono" data-testid="secret-name" />
                  {edit.name && !SECRET_NAME.test(edit.name) && <p className="text-[11px] text-status-critical-ink">Upper case letters, digits and underscores, starting with a letter.</p>}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={edit.generate} onCheckedChange={(c) => setEdit({ ...edit, generate: c === true })} data-testid="secret-generate" /> Generate 32 random bytes (shown once)</label>
              {!edit.generate && <Input type="password" autoComplete="off" value={edit.value} placeholder="Paste the value" onChange={(e) => setEdit({ ...edit, value: e.target.value })} data-testid="secret-value" />}
              {error && <p className="text-xs text-status-critical-ink" data-testid="secret-error">{error}</p>}
            </div>
          )}
          <DialogFooter>
            <Button disabled={!edit || !SECRET_NAME.test(edit.name) || (!edit.generate && !edit.value)} onClick={submit} data-testid="secret-submit">{edit?.mode === "rotate" ? "Rotate" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {del?.name}?</DialogTitle>
            <DialogDescription>
              {del?.usedBy.length ? <>It is still used by {del.usedBy.map((u) => u.where).join(", ")}. Change those first; the delete will be refused.</> : "Nothing refers to it. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="destructive" onClick={remove} data-testid="secret-delete-confirm">Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <OnceDialog shown={shown} onClose={() => setShown(null)} />
    </div>
  );
}
