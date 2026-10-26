import { ExternalLink, RotateCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStatus } from "@/app/StatusBanners";
import type { WindowProps } from "./registry";

/** code-server in the browser: the box config and home by default, or the whole box. File › Open Folder reaches anywhere. */
export const editorUrl = (target: { workspaceFile?: string; folder?: string }) =>
  target.folder ? `/code/?folder=${encodeURIComponent(target.folder)}` : `/code/?workspace=${encodeURIComponent(target.workspaceFile ?? "")}`;

export function CodeWindow({ spec, update }: WindowProps) {
  const editor = useStatus().data?.editor;
  const [nonce, setNonce] = useState(0);
  const target: string = spec.props.target ?? "all";
  if (!editor) return <div className="p-4 text-xs text-muted-foreground">Loading…</div>;
  if (!editor.on)
    return (
      <div className="grid h-full content-center gap-2 p-6 text-sm" data-testid="code-off">
        <p className="font-medium">The editor is off.</p>
        <p className="text-xs text-muted-foreground">
          {editor.installed ? "It is installed." : <>Install it once in a terminal on the box: <code>wb tools install code-server</code>.</>} Then turn it on in{" "}
          <Link to="/settings" className="underline">Settings › General › Editor</Link>.
        </p>
      </div>
    );
  const url =
    target === "all" ? editorUrl({ workspaceFile: editor.workspaceFile })
    : target === "workspace" ? editorUrl({ folder: editor.workspaceDir })
    : target === "box" ? editorUrl({ folder: "/" })
    : editorUrl({ folder: editor.homeDir });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <Select value={target} onValueChange={(v) => update({ target: v })}>
          <SelectTrigger size="sm" className="h-7 w-56 text-xs" data-testid="code-target"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Box config and home</SelectItem>
            <SelectItem value="home">Home folder</SelectItem>
            <SelectItem value="workspace">Box config only</SelectItem>
            <SelectItem value="box">The whole box (/)</SelectItem>
          </SelectContent>
        </Select>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">Its terminal is fine for quick commands; use <code>zellij attach</code> or a Terminal window for anything long-running.</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => setNonce((n) => n + 1)} aria-label="Reload"><RotateCw className="size-3.5" /></Button>
        <Button variant="ghost" size="icon" className="size-7" asChild aria-label="Open in new tab"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /></a></Button>
      </div>
      <iframe key={`${url}-${nonce}`} src={url} title="Editor" className="min-h-0 w-full flex-1 border-0 bg-background" data-testid="code-frame" />
    </div>
  );
}
