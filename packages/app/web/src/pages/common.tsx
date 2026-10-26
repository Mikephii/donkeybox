import { useCallback, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Read and write URL search params; every page filter lives in the URL. */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const getList = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
  const set = useCallback(
    (patch: Record<string, string | string[] | number | null | undefined>, opts: { resetPage?: boolean } = { resetPage: true }) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            const s = Array.isArray(v) ? v.join(",") : v == null ? "" : String(v);
            if (s) n.set(k, s);
            else n.delete(k);
          }
          if (opts.resetPage && !("page" in patch)) n.delete("page");
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { params, get, getList, set };
}

export function MultiFilter({ label, options, value, onChange, testid }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; testid?: string }) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const shown = value.length ? value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ") : `Any ${label.toLowerCase()}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 max-w-56 gap-1 text-xs", value.length && "border-primary/50")} data-testid={testid}>
          <span className="text-muted-foreground">{label}:</span> <span className="truncate">{shown}</span> <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} onSelect={(e) => e.preventDefault()}>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => onChange([])}>Clear</DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Errors whose path starts with `path` (e.g. "group.actions.0.label"). */
export const errorsAt = (errors: string[], path: string) => errors.filter((e) => e.startsWith(`${path}:`) || e.startsWith(`${path}.`)).map((e) => e.replace(/^[^:]+:\s*/, ""));

export function Field({ label, hint, errors = [], children, className }: { label: string; hint?: ReactNode; errors?: string[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && !errors.length && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {errors.map((e, i) => <p key={i} className="text-[11px] text-status-critical-ink" data-testid="field-error">{e}</p>)}
    </div>
  );
}

export function StringList({ value, onChange, placeholder, testid }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; testid?: string }) {
  return (
    <div className="grid gap-1.5" data-testid={testid}>
      {value.map((v, i) => (
        <div key={i} className="flex gap-1.5">
          <Input className="h-8 font-mono text-xs" value={v} placeholder={placeholder} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove"><X className="size-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs" onClick={() => onChange([...value, ""])}><Plus className="size-3.5" /> Add</Button>
    </div>
  );
}

export function KeyValues({ value, onChange, keyPlaceholder = "key", valuePlaceholder = "value", rowExtra }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyPlaceholder?: string; valuePlaceholder?: string; rowExtra?: (key: string, value: string, set: (v: string) => void) => ReactNode }) {
  const rows = Object.entries(value);
  const write = (next: [string, string][]) => onChange(Object.fromEntries(next));
  return (
    <div className="grid gap-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <Input className="h-8 font-mono text-xs" value={k} placeholder={keyPlaceholder} onChange={(e) => write(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <Input className="h-8 font-mono text-xs" value={v} placeholder={valuePlaceholder} onChange={(e) => write(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          {rowExtra?.(k, v, (nv) => write(rows.map((r, j) => (j === i ? [r[0], nv] : r))))}
          <Button variant="ghost" size="icon" className="size-8" onClick={() => write(rows.filter((_, j) => j !== i))} aria-label="Remove"><X className="size-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs" onClick={() => write([...rows, ["", ""]])}><Plus className="size-3.5" /> Add</Button>
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t px-5 py-2 text-xs" data-testid="pager">
      <Button variant="outline" size="sm" className="h-7" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="tabular-nums text-muted-foreground">Page {page} of {pages}</span>
      <Button variant="outline" size="sm" className="h-7" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

export const STATUS_OPTIONS = ["queued", "starting", "working", "blocked", "idle", "done", "failed", "stopped", "interrupted"].map((s) => ({ value: s, label: s }));
export const TRIGGER_OPTIONS = [
  { value: "webhook", label: "Webhook" },
  { value: "schedule", label: "Schedule" },
  { value: "ui-action", label: "Person in the UI" },
  { value: "agent", label: "Agent" },
  { value: "cli", label: "wb CLI" },
  { value: "continuation", label: "Continued run" },
];
