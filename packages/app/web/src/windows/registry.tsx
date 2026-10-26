import type { ComponentType } from "react";
import { Link } from "react-router";
import { Activity, Code2, FileText, Globe, Inbox, ListChecks, Server, Settings2, SquareTerminal, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WindowSpec, WindowType } from "@/lib/yjs";
import { terminalAction, TerminalWindow, type TerminalAction } from "./TerminalWindow";
import { RequestsWindow } from "./RequestsWindow";
import { RunsWindow } from "./RunsWindow";
import { ServicesWindow } from "./ServicesWindow";
import { PreviewWindow } from "./PreviewWindow";
import { DevToolsWindow } from "./DevToolsWindow";
import { ActivityWindow } from "./ActivityWindow";
import { CodeWindow } from "./CodeWindow";
import { DocWindow } from "./DocWindow";

export interface WindowProps {
  spec: WindowSpec;
  update: (props: Record<string, any>) => void;
}

/** The Config window became the Workflows and Sources pages. Old ones on a canvas point there. */
function ConfigMoved() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-4 text-sm">
      <p>Configuration moved to its own pages.</p>
      <div className="flex gap-2">
        <Button size="sm" asChild><Link to="/workflows">Open Workflows</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/sources">Open Sources</Link></Button>
      </div>
      <p className="text-xs text-muted-foreground">Close this window from its menu once the canvas is unlocked.</p>
    </div>
  );
}

interface Def {
  label: string;
  icon: ComponentType<{ className?: string }>;
  component: ComponentType<WindowProps>;
  w: number;
  h: number;
  props: Record<string, any>;
  hidden?: boolean;
  /** Extra items for the window's menu. */
  menu?: { label: string; action: string; testid?: string }[];
  onMenu?: (spec: WindowSpec, action: string) => void;
}

export const windowTypes: Record<WindowType, Def> = {
  requests: { label: "Requests", icon: Inbox, component: RequestsWindow, w: 520, h: 420, props: { groups: [] } },
  runs: { label: "Live runs", icon: ListChecks, component: RunsWindow, w: 520, h: 380, props: { live: true } },
  terminal: {
    label: "Terminal", icon: SquareTerminal, component: TerminalWindow, w: 760, h: 520, props: { session: "shell" },
    menu: [
      { label: "New terminal…", action: "new", testid: "window-terminal-new" },
      { label: "Rename terminal…", action: "rename", testid: "window-terminal-rename" },
      { label: "End terminal session…", action: "close", testid: "window-terminal-close" },
    ],
    onMenu: (spec, action) => terminalAction(spec.id, action as TerminalAction),
  },
  preview: { label: "Preview", icon: Globe, component: PreviewWindow, w: 640, h: 440, props: { port: 3333, path: "/" } },
  services: { label: "Services", icon: Server, component: ServicesWindow, w: 520, h: 360, props: {} },
  activity: { label: "Activity", icon: Activity, component: ActivityWindow, w: 560, h: 320, props: {} },
  code: { label: "Code", icon: Code2, component: CodeWindow, w: 980, h: 620, props: { target: "all" } },
  devtools: { label: "DevTools", icon: Wrench, component: DevToolsWindow, w: 760, h: 520, props: {} },
  doc: { label: "Document", icon: FileText, component: DocWindow, w: 560, h: 560, props: { path: "" } },
  config: { label: "Config (moved)", icon: Settings2, component: ConfigMoved, w: 420, h: 200, props: {}, hidden: true },
};

export function windowTitle(spec: WindowSpec): string {
  if (spec.title) return spec.title;
  const base = windowTypes[spec.type]?.label ?? spec.type;
  if (spec.type === "terminal") return `Terminal · ${spec.props.session ?? "?"}`;
  if (spec.type === "preview") return `Preview · :${spec.props.port}`;
  if (spec.type === "doc") return `Document · ${String(spec.props.path ?? "").split("/").pop() || "?"}`;
  return base;
}

/** Windows that are a small version of a page link to it. */
export function windowPage(spec: WindowSpec): string | null {
  switch (spec.type) {
    case "requests": {
      const groups: string[] = spec.props.groups ?? [];
      return groups.length ? `/inbox?group=${encodeURIComponent(groups.join(","))}` : "/inbox";
    }
    case "runs":
      return "/runs";
    case "services":
      return "/services";
    case "activity":
      return "/activity";
    case "config":
      return "/workflows";
    default:
      return null;
  }
}
