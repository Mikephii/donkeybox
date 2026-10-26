import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WindowSpec } from "@/lib/yjs";
import { windowTitle } from "@/windows/registry";
import { updateWindow } from "./windowActions";

export function WindowSettingsDialog({ spec, open, onOpenChange }: { spec: WindowSpec; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState(spec.title ?? "");
  const [description, setDescription] = useState(spec.description ?? "");
  useEffect(() => {
    if (open) {
      setTitle(spec.title ?? "");
      setDescription(spec.description ?? "");
    }
  }, [open, spec.title, spec.description]);
  const save = () => {
    updateWindow(spec.id, { title: title.trim() || undefined, description: description.trim() || undefined });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Window name and description</DialogTitle>
          <DialogDescription>Everyone on this canvas sees these. The description shows behind the info icon.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), save())}>
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input autoFocus value={title} placeholder={windowTitle({ ...spec, title: undefined })} onChange={(e) => setTitle(e.target.value)} data-testid="window-name" />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea rows={4} value={description} placeholder="What is this window for?" onChange={(e) => setDescription(e.target.value)} data-testid="window-description" />
          </div>
          <DialogFooter>
            <Button type="submit" data-testid="window-save">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
