import { ShellHint } from "@/components/ShellHint";
import { Link } from "react-router";
import { ArrowRight, CheckCircle2, Circle, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useCan, useMe } from "@/app/context";

export interface SetupView {
  items: { id: string; title: string; done: boolean; optional: boolean; detail: string; link: string }[];
  complete: boolean;
  hasAdmin: boolean;
  bootstrapAdmin: string | null;
  authMode: string;
}

export function useSetup() {
  return useApi<SetupView>("/setup", ["config", "events", "runs"], 20_000);
}

/** Everything a new box needs, each item checking itself. It leaves the sidebar once the required ones are done. */
export function SetupPage() {
  const { data, reload } = useSetup();
  const me = useMe();
  const canClaim = useCan("member");
  const claim = async () => {
    try {
      await api("/setup/claim-admin", { method: "POST" });
      toast.success("You are the first admin. Add your team in Settings › People.");
      reload();
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const required = data?.items.filter((i) => !i.optional) ?? [];
  const doneCount = required.filter((i) => i.done).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Setup" description="What this box still needs. Each item checks itself; fix one and it turns green." subject="page:/setup" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid max-w-3xl gap-4 p-6" data-testid="setup">
          {data && (
            <p className="text-sm" data-testid="setup-progress">
              {data.complete ? "This box is set up. The optional items are still worth a look." : `${doneCount} of ${required.length} done.`}
            </p>
          )}
          {data && !data.hasAdmin && (
            <section className="grid gap-2 rounded-lg border border-status-warning/50 bg-status-warning-subtle p-4 text-sm" data-testid="setup-claim">
              <div className="font-medium">Nobody is an admin yet</div>
              <p className="text-xs text-muted-foreground">
                Whoever finishes setting up becomes the first admin. That can be you, {me?.email}.
                {data.authMode === "proxy" && " Once anyone is listed in Settings › People, only listed people and domains get in, so add your team or your domain straight after."}
              </p>
              <Button size="sm" className="w-fit" disabled={!canClaim} onClick={claim} data-testid="setup-claim-admin">Make me the admin</Button>
            </section>
          )}
          <ol className="grid gap-2">
            {(data?.items ?? []).map((i) => (
              <li key={i.id} className={cn("flex items-start gap-3 rounded-lg border p-3", i.done && "bg-muted/30")} data-testid={`setup-item-${i.id}`} data-done={i.done}>
                {i.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-status-good-ink" /> : i.optional ? <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" /> : <Circle className="mt-0.5 size-5 shrink-0 text-status-warning-ink" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {i.title}
                    {i.optional && <Badge variant="outline" className="h-4 px-1 text-[10px]">optional</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>
                </div>
                {!i.done && (
                  <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-xs" asChild>
                    <Link to={i.link}>Go <ArrowRight className="size-3.5" /></Link>
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <ShellHint>
            Every item can also be done by hand. The box is an ordinary machine with a shell: sign in to Claude Code, clone repos, edit the workspace's files or set environment variables however you like, and this list checks the result.
          </ShellHint>
          <p className="text-xs text-muted-foreground">
            The <Link to="/guide" className="underline">Guide</Link> explains each step. Hosting guides for each way of running a box are in the product's <code>docs/hosting/</code> folder.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
