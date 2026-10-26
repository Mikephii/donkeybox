import { ExternalLink, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WindowProps } from "./registry";

export function PreviewWindow({ spec, update }: WindowProps) {
  const port = Number(spec.props.port ?? 3333);
  const path: string = spec.props.path ?? "/";
  const [draft, setDraft] = useState(String(port));
  const [nonce, setNonce] = useState(0);
  const src = `/p/${port}${path.startsWith("/") ? path : `/${path}`}`;
  return (
    <div className="flex h-full flex-col">
      <form className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs" onSubmit={(e) => (e.preventDefault(), update({ port: Number(draft) || port }))}>
        <span className="text-muted-foreground">localhost:</span>
        <Input value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))} className="h-7 w-20 text-xs" aria-label="Port"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), update({ port: Number(draft) || port }))}
          onBlur={() => Number(draft) && Number(draft) !== port && update({ port: Number(draft) })} />
        <Input value={path} onChange={(e) => update({ path: e.target.value })} className="h-7 flex-1 text-xs" aria-label="Path" />
        <Button variant="ghost" size="icon" className="size-7" type="button" onClick={() => setNonce((n) => n + 1)} aria-label="Reload"><RotateCw className="size-3.5" /></Button>
        <Button variant="ghost" size="icon" className="size-7" asChild aria-label="Open in new tab"><a href={src} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /></a></Button>
      </form>
      <iframe key={`${src}-${nonce}`} src={src} title={`preview ${port}`} className="min-h-0 w-full flex-1 border-0 bg-white" />{/* white on purpose: a web page assumes the browser's white canvas, whatever the box's theme */}
    </div>
  );
}
