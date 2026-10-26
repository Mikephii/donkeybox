import { Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOthersOn } from "@/lib/presence";

export const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

/** Avatars of the other people looking at the same page, run, request or canvas. */
export function PresenceDots({ subject }: { subject: string }) {
  const others = useOthersOn(subject);
  if (!others.length) return null;
  return (
    <div className="flex -space-x-1.5" data-testid="page-presence">
      {others.map((s) => (
        <Tooltip key={s.user.email}>
          <TooltipTrigger asChild>
            <span className={`relative flex size-7 items-center justify-center rounded-full text-[11px] font-medium text-white ring-2 ring-background ${s.user.role === "viewer" ? "opacity-70 outline-1 outline-dashed outline-offset-1 outline-muted-foreground" : ""}`} style={{ background: s.user.color }} data-role={s.user.role ?? "member"}>
              {initials(s.user.name)}
              {s.user.role === "viewer" && <Eye className="absolute -bottom-1 -right-1 size-3 rounded-full bg-background p-[1px] text-foreground" />}
            </span>
          </TooltipTrigger>
          <TooltipContent>{s.user.name} is here{s.user.role === "viewer" ? " (watching)" : ""}{s.focus?.typing ? " · typing in a terminal" : ""}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
