import { Gate } from "@/components/Gate";
import { useImperativeHandle, useState, type Ref } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, type Action, type Req } from "@/lib/api";

const variant = (s?: string) => (s === "primary" ? "default" : s === "danger" ? "destructive" : "outline");

export interface ActionBarHandle {
  /** Press the n-th button (1-based), as the Inbox number keys do. */
  press(n: number): void;
  cancel(): void;
  formOpen(): boolean;
}

/** Renders a request's buttons; actions with an input schema open a small form first. */
export function ActionBar({ req, onDone, ref, showKeys }: { req: Req; onDone?: () => void; ref?: Ref<ActionBarHandle>; showKeys?: boolean }) {
  const [active, setActive] = useState<Action | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (a: Action, input: Record<string, any>) => {
    setBusy(true);
    try {
      await api(`/requests/${req.id}/answer`, { body: { action_id: a.id, input } });
      toast.success(`${a.label}: ${req.title}`);
      setActive(null);
      setValues({});
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (a: Action) => (a.input && Object.keys(a.input).length ? setActive(a) : submit(a, {}));

  useImperativeHandle(ref, () => ({
    press: (n: number) => {
      const a = req.actions[n - 1];
      if (a && req.status === "open" && !busy) choose(a);
    },
    cancel: () => (setActive(null), setValues({})),
    formOpen: () => !!active,
  }));

  if (req.status !== "open") return null;
  if (active) {
    return (
      <form className="space-y-2 rounded-md border bg-muted/40 p-2" data-testid={`action-form-${req.id}`}
        onSubmit={(e) => (e.preventDefault(), submit(active, values))}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.stopPropagation(), setActive(null), setValues({}));
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), submit(active, values));
        }}>
        {Object.entries(active.input ?? {}).map(([k, t], i) => (
          <div key={k} className="space-y-1">
            <Label className="text-xs capitalize">{k.replace(/_/g, " ")}</Label>
            {t === "text" ? (
              <Textarea autoFocus={i === 0} rows={3} value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            ) : t === "boolean" ? (
              <Checkbox checked={!!values[k]} onCheckedChange={(c) => setValues({ ...values, [k]: c === true })} />
            ) : typeof t === "object" && t?.enum ? (
              <Select value={values[k] ?? ""} onValueChange={(v) => setValues({ ...values, [k]: v })}>
                <SelectTrigger size="sm"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{t.enum.map((o: string) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input autoFocus={i === 0} type={t === "number" ? "number" : "text"} value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            )}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button size="sm" type="submit" variant={variant(active.style)} disabled={busy}>{active.label}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => (setActive(null), setValues({}))}>Cancel</Button>
          {showKeys && <span className="ml-auto text-[11px] text-muted-foreground"><Kbd>⌘</Kbd><Kbd>Enter</Kbd> send · <Kbd>Esc</Kbd> cancel</span>}
        </div>
      </form>
    );
  }
  return (
    <Gate need="member">
    <div className="flex flex-wrap gap-1.5" data-testid={`actions-${req.id}`}>
      {req.actions.map((a, i) => (
        <Button key={a.id} size="sm" className="h-7 gap-1.5" variant={variant(a.style)} disabled={busy} onClick={() => choose(a)}>
          {showKeys && i < 9 && <Kbd className="h-4 min-w-4 px-1 text-[10px]">{i + 1}</Kbd>}
          {a.label}
        </Button>
      ))}
    </div>
    </Gate>
  );
}
