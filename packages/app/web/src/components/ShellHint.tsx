import type { ReactNode } from "react";
import { SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A reminder that the page is one way of doing something, not the only one: the box is an ordinary
 * machine and the workspace an ordinary folder, so a terminal, the editor or an agent works too.
 */
export function ShellHint({ children, className, bar }: { children: ReactNode; className?: string; bar?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground",
        bar ? "border-b bg-muted/20 px-5 py-1.5" : "rounded-md border border-dashed px-2.5 py-1.5",
        className,
      )}
      data-testid="shell-hint"
    >
      <SquareTerminal className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
