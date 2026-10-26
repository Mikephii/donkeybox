import { useEffect, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useCan, type Role } from "@/app/context";
import { useBoxName } from "@/app/BoxName";
import { PresenceDots } from "./PresenceDots";

export function PageHeader({ title, description, subject, children, need }: { title: ReactNode; description?: ReactNode; subject: string; children?: ReactNode; need?: Role }) {
  const box = useBoxName();
  const allowed = useCan(need ?? "viewer");
  // Every page title names the box, so tabs from several boxes can be told apart.
  useEffect(() => {
    if (typeof title === "string") document.title = `${title} · ${box}`;
  }, [title, box]);
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-5 py-2">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {!allowed && <Badge variant="outline" className="h-6 text-[11px]" data-testid="read-only-badge">{need === "admin" ? "Read only: admins change this" : "Read only"}</Badge>}
        <PresenceDots subject={subject} />
        {children}
      </div>
    </header>
  );
}

export function ErrorList({ errors, strip }: { errors: string[]; strip?: string }) {
  if (!errors.length) return null;
  return (
    <ul className="space-y-0.5 rounded-md border border-status-critical/40 bg-status-critical-subtle p-2 text-xs text-status-critical-ink" data-testid="form-errors">
      {errors.map((e, i) => <li key={i}>{strip ? e.replace(strip, "") : e}</li>)}
    </ul>
  );
}
