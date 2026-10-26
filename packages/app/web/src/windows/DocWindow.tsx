// A Document window: a markdown file on the box, rendered, and kept up to date while it is open. A skill
// run by hand writes its result to a file and opens it here (`wb open FILE`), so a proposal reads as a
// page rather than as terminal text.
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "@/app/Markdown";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { WindowProps } from "./registry";

interface Doc { path: string; content: string; mtime: string }

export function DocWindow({ spec, update }: WindowProps) {
  const path: string = spec.props.path ?? "";
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let stop = false;
    let last = "";
    const load = async () => {
      try {
        const d = await api<Doc>(`/docs?path=${encodeURIComponent(path)}`);
        if (stop) return;
        setError(null);
        if (d.mtime !== last) ((last = d.mtime), setDoc(d));
      } catch (e) {
        if (!stop) setError(e instanceof ApiError ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => ((stop = true), clearInterval(t));
  }, [path]);

  if (!path)
    return (
      <Empty>
        <form className="grid w-full max-w-sm gap-2" onSubmit={(e) => (e.preventDefault(), update({ path: String(new FormData(e.currentTarget).get("path") ?? "").trim() }))}>
          <span>A markdown file on the box, or run <code>wb open FILE.md</code> in a terminal.</span>
          <Input name="path" placeholder="/data/workspace/README.md" className="h-8 text-xs" aria-label="File" />
        </form>
      </Empty>
    );
  if (error && !doc) return <Empty>{error}</Empty>;
  if (!doc) return <Empty>Loading {path}…</Empty>;
  return (
    <div className="flex h-full flex-col" data-testid="doc-window">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <FileText className="size-3.5" />
        <span className="truncate font-mono">{doc.path}</span>
        <span className="ml-auto shrink-0">{new Date(doc.mtime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <Markdown>{doc.content}</Markdown>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{children}</div>;
}
