import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { terminalThemes, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

let login: Promise<void> | null = null;
/** Logs this browser into Zellij's web client once per page load (the app mints a token named after your email). */
export function ensureTermLogin(): Promise<void> {
  login ??= api("/term-login", { body: {} }).then(
    () => undefined,
    (e) => {
      login = null;
      throw e;
    },
  );
  return login;
}

/**
 * A Zellij web-client iframe. Same-origin, so the page reaches into it and sets the
 * xterm.js palette from the viewer's theme cookie: each person sees their own theme.
 */
export function TerminalFrame({ session, className, title }: { session: string; className?: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const { resolved } = useTheme();
  const theme = terminalThemes[resolved];
  const [ready, setReady] = useState(false);
  const [themed, setThemed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureTermLogin().then(() => setReady(true), (e) => setError(e.message));
  }, []);

  // Apply the palette whenever the theme changes or the client recreates its terminal (e.g. after a reconnect).
  useEffect(() => {
    let lastTerm: unknown = null;
    let lastTheme: unknown = null;
    const tick = () => {
      try {
        const w = ref.current?.contentWindow as any;
        const term = w?.term;
        if (!term) return;
        if (term !== lastTerm || lastTheme !== theme) {
          term.options.theme = theme;
          w.document.body.style.background = theme.background;
          const el = w.document.getElementById("terminal");
          if (el) el.style.background = theme.background;
          lastTerm = term;
          lastTheme = theme;
          setThemed(true);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [theme, ready, session]);

  if (error) return <div className="p-4 text-sm text-status-critical-ink">Terminal login failed: {error}. Is the Zellij web server running (pnpm zellij:web)?</div>;
  if (!ready) return <div className="p-4 text-sm text-muted-foreground">Signing in to the terminal…</div>;
  return (
    <iframe
      ref={ref}
      key={session}
      data-terminal="1"
      title={title ?? `terminal ${session}`}
      src={`/term/${encodeURIComponent(session)}`}
      className={cn("h-full w-full border-0 transition-opacity", themed ? "opacity-100" : "opacity-0", className)}
      style={{ background: theme.background }}
      onLoad={() => setThemed(false)}
    />
  );
}
