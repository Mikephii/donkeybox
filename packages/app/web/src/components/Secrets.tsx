import { useState } from "react";
import { Copy, KeyRound, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export interface SecretRow {
  name: string;
  from: "store" | "env" | null;
  createdAt: string | null;
  updatedAt: string | null;
  usedBy: { where: string; link: string }[];
}
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Turns "jira hook" or "atlassian/Authorization" into JIRA_HOOK / ATLASSIAN_AUTHORIZATION. */
export const toSecretName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^[^A-Z]+|_+$/g, "").slice(0, 64) || "SECRET";

export function useSecrets() {
  return useApi<{ backend: "file" | "gcp" | null; secrets: SecretRow[] }>("/secrets", ["config"]);
}

/** Shows a just-generated value once. It cannot be shown again. */
export function OnceDialog({ shown, onClose }: { shown: { name: string; value: string; hint?: string; extra?: { label: string; value: string } } | null; onClose: () => void }) {
  return (
    <Dialog open={!!shown} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="secret-once">
        <DialogHeader>
          <DialogTitle>Copy {shown?.name} now</DialogTitle>
          <DialogDescription>This is the only time the value is shown. {shown?.hint ?? "Paste it into the sender's settings."} To change it later, rotate it.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <code className="flex-1 break-all rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="secret-once-value">{shown?.value}</code>
          <Button variant="outline" size="sm" className="h-auto gap-1" onClick={() => (navigator.clipboard.writeText(shown!.value), toast.success("Copied"))}><Copy className="size-3.5" /> Copy</Button>
        </div>
        {shown?.extra && (
          <div className="grid gap-1">
            <div className="text-xs font-medium">{shown.extra.label}</div>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="secret-once-extra">{shown.extra.value}</code>
              <Button variant="outline" size="sm" className="h-auto gap-1" onClick={() => (navigator.clipboard.writeText(shown.extra!.value), toast.success("Copied"))}><Copy className="size-3.5" /> Copy</Button>
            </div>
          </div>
        )}
        <DialogFooter><Button onClick={onClose} data-testid="secret-once-done">I have copied it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SecretState({ row }: { row: SecretRow | undefined }) {
  if (row?.from === "store") return <Badge variant="outline" className="h-5 px-1.5 text-[10px]" data-testid="secret-state">set</Badge>;
  if (row?.from === "env") return <Badge variant="outline" className="h-5 px-1.5 text-[10px]" data-testid="secret-state">from environment</Badge>;
  return <Badge variant="warning" className="h-5 px-1.5 text-[10px]" data-testid="secret-state">not set</Badge>;
}

/**
 * A field holding a secret NAME (never a value), with its state and a Generate button that creates
 * the secret in the store and shows the value once.
 */
export function SecretNameField({ value, onChange, suggest, hint, testid, canGenerate = true, reveal }: { value: string; onChange: (v: string) => void; suggest: string; hint?: string; testid?: string; canGenerate?: boolean; reveal?: (value: string) => { label: string; value: string } }) {
  const { data, reload } = useSecrets();
  const [shown, setShown] = useState<{ name: string; value: string; hint?: string; extra?: { label: string; value: string } } | null>(null);
  const row = data?.secrets.find((s) => s.name === value);
  const generate = async () => {
    const name = value || suggest;
    try {
      const r = await api<{ name: string; value: string }>("/secrets", { body: { name, generate: true } });
      onChange(r.name);
      setShown({ name: r.name, value: r.value, hint, extra: reveal?.(r.value) });
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input list="wb-secret-names" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 font-mono text-xs" placeholder={suggest} data-testid={testid} />
        <datalist id="wb-secret-names">{data?.secrets.map((s) => <option key={s.name} value={s.name} />)}</datalist>
        {value && <SecretState row={row} />}
        {(!row || !row.from) && !canGenerate && <a href="/secrets" className="shrink-0 text-[11px] underline">Store it on the Secrets page</a>}
        {(!row || !row.from) && canGenerate && (
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1 text-xs" onClick={generate} data-testid={testid ? `${testid}-generate` : undefined}>
            <Sparkles className="size-3.5" /> Generate
          </Button>
        )}
      </div>
      <OnceDialog shown={shown} onClose={() => setShown(null)} />
    </div>
  );
}

/**
 * For MCP env and header values: generate a secret, or move a pasted token into the store, and put a
 * ${secret:NAME} reference in its place so the value never lands in config.json.
 */
export function SecretValueMenu({ value, onChange, suggest }: { value: string; onChange: (v: string) => void; suggest: string }) {
  const [shown, setShown] = useState<{ name: string; value: string } | null>(null);
  const [storing, setStoring] = useState(false);
  const [name, setName] = useState(suggest);
  const isRef = /\$\{secret:[A-Z0-9_]+\}/.test(value);
  const generate = async () => {
    try {
      const r = await api<{ name: string; value: string }>("/secrets", { body: { name: suggest, generate: true } });
      onChange(`\${secret:${r.name}}`);
      setShown(r);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const store = async () => {
    try {
      // A "Bearer xyz" value keeps its prefix; only the token goes into the store.
      const m = value.match(/^(Bearer |Basic |token )?(.+)$/);
      await api("/secrets", { body: { name, value: m?.[2] ?? value } });
      onChange(`${m?.[1] ?? ""}\${secret:${name}}`);
      setStoring(false);
      toast.success(`Stored as ${name}; config.json keeps only the name`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Use a secret" data-testid="secret-menu"><KeyRound className="size-3.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={generate}>Generate a new secret</DropdownMenuItem>
          <DropdownMenuItem disabled={!value || isRef} onSelect={() => (setName(suggest), setStoring(true))}>Move this value into the secrets store</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <OnceDialog shown={shown} onClose={() => setShown(null)} />
      <Dialog open={storing} onOpenChange={setStoring}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move into the secrets store</DialogTitle>
            <DialogDescription>The value is stored on the box and the field keeps a <code>{"${secret:NAME}"}</code> reference.</DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="font-mono" />
          {!SECRET_NAME.test(name) && <p className="text-xs text-status-critical-ink">Upper case letters, digits and underscores, starting with a letter.</p>}
          <DialogFooter><Button disabled={!SECRET_NAME.test(name)} onClick={store}>Store it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
