import { Activity, BookOpen, Check, Inbox, ListTodo, KeyRound, LayoutGrid, ListChecks, Monitor, Moon, Plug, Server, Settings, Sun, Workflow } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/components/PresenceDots";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/hooks";
import { useTheme, type ThemePref } from "@/lib/theme";
import { awareness } from "@/lib/yjs";
import { useMe } from "./context";
import { useBoxName } from "./BoxName";
import { useSetup } from "@/pages/SetupPage";
import { Mark } from "@/components/signature";

export const LAST_CANVAS = "wb-last-canvas";

export function Sidebar() {
  const me = useMe()!;
  const loc = useLocation();
  const { pref, setPref } = useTheme();
  const boxName = useBoxName();
  const { data: counts } = useApi<{ open: number }>("/requests/counts", ["requests"], 15_000);
  let lastCanvas = "";
  try {
    lastCanvas = sessionStorage.getItem(LAST_CANVAS) ?? "";
  } catch {}
  const setup = useSetup().data;
  const items = [
    // Setup stays in the sidebar until every required item is done.
    ...(setup && !setup.complete ? [{ to: "/setup", label: "Setup", icon: ListTodo, badge: setup.items.filter((i) => !i.optional && !i.done).length }] : []),
    { to: lastCanvas ? `/c/${lastCanvas}` : "/", match: "/c/", label: "Canvases", icon: LayoutGrid },
    { to: "/inbox", label: "Inbox", icon: Inbox, badge: counts?.open },
    { to: "/runs", label: "Runs", icon: ListChecks },
    { to: "/workflows", label: "Workflows", icon: Workflow },
    { to: "/sources", label: "Sources", icon: Plug },
    { to: "/secrets", label: "Secrets", icon: KeyRound },
    { to: "/services", label: "Services", icon: Server },
    { to: "/activity", label: "Activity", icon: Activity },
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/guide", label: "Guide", icon: BookOpen },
  ];
  const active = (to: string, match?: string) => (match ? loc.pathname.startsWith(match) || loc.pathname === "/" : loc.pathname === to || loc.pathname.startsWith(`${to}/`) || (to === "/inbox" && loc.pathname.startsWith("/requests")));
  const ThemeIcon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;

  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2 text-sidebar-foreground" data-testid="sidebar">
      <Mark className="mt-1 size-6" />
      <span className="mb-2 mt-1 line-clamp-2 w-14 break-words text-center text-[10px] font-bold leading-tight tracking-tight" title={boxName} data-testid="box-name">{boxName}</span>
      {items.map((it) => (
        <NavLink key={it.label} to={it.to} data-testid={`nav-${it.label.toLowerCase()}`}
          className={cn("relative flex w-14 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground", active(it.to, it.match) && "bg-sidebar-accent font-medium text-sidebar-accent-foreground")}>
          <it.icon className="size-[18px]" />
          {it.label}
          {!!it.badge && <span className="absolute right-1.5 top-0.5 min-w-4 rounded-full bg-status-warning px-1 text-center font-mono text-[10px] font-semibold leading-4 tabular-nums text-warning-foreground" data-testid={it.label === "Inbox" ? "inbox-count" : `${it.label.toLowerCase()}-count`}>{it.badge}</span>}
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col items-center gap-2">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="Theme" data-testid="theme-toggle"><ThemeIcon /></Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Theme</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            {(["light", "dark", "system"] as ThemePref[]).map((t) => (
              <DropdownMenuItem key={t} onSelect={() => setPref(t)} data-testid={`theme-${t}`}>
                <Check className={cn("size-4", pref === t ? "opacity-100" : "opacity-0")} />
                {t[0]!.toUpperCase() + t.slice(1)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-muted-foreground" data-testid="me-label">
              {me.email}{me.authMode === "dev" ? " (dev auth)" : ""}
              <span className="block text-[11px]">{me.role === "admin" ? "Admin" : me.role === "viewer" ? "Viewer: you can look, not change" : "Member"}</span>
            </DropdownMenuLabel>
            {me.authMode === "oidc" && <DropdownMenuItem asChild><a href="/auth/logout">Sign out</a></DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex size-8 items-center justify-center rounded-full text-[11px] font-medium text-white" style={{ background: awareness.getLocalState()?.user?.color }} title={me.email} data-testid="me">
          {initials(me.name)}
        </span>
      </div>
    </nav>
  );
}
