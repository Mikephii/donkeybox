import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, type GroupInfo, type Run } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSidePane } from "@/app/context";
import { useLocation, useNavigate } from "react-router";

export function StartRunDialog({ children }: { children: React.ReactNode }) {
  const { data: groups } = useApi<GroupInfo[]>("/groups", ["config"]);
  const pane = useSidePane();
  const navigate = useNavigate();
  const onCanvas = useLocation().pathname.startsWith("/c/");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ group: "", prompt: "", title: "", mode: "interactive", goal: "" });
  const submit = async () => {
    try {
      const run = await api<Run>("/runs", { body: { ...f, group: f.group || groups?.[0]?.id } });
      setOpen(false);
      setF({ ...f, prompt: "", title: "", goal: "" });
      // On a canvas, peek in the side pane; elsewhere, go to the run's page.
      if (onCanvas) pane.open("run", run.id);
      else navigate(`/runs/${run.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a run</DialogTitle>
          <DialogDescription>Starts an agent in a hidden terminal session with the group's skill, tools and policy.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Group</Label>
            <Select value={f.group || groups?.[0]?.id} onValueChange={(v) => setF({ ...f, group: v })}>
              <SelectTrigger><SelectValue placeholder="Group" /></SelectTrigger>
              <SelectContent>{(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.title} · {g.autonomy}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Prompt</Label>
            <Textarea rows={4} placeholder="/jira-tickets delete DEMO-2, it's a duplicate" value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} data-testid="run-prompt" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Title (optional)</Label>
              <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Mode</Label>
              <Select value={f.mode} onValueChange={(v) => setF({ ...f, mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="interactive">Interactive (hidden session)</SelectItem>
                  <SelectItem value="print">Print (headless)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Goal check (optional shell command that must pass before the run may stop)</Label>
            <Input className="font-mono text-xs" placeholder='test -f DONE.txt' value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!f.prompt.trim()} data-testid="run-start">Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
