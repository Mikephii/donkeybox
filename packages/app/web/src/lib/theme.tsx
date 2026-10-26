import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Resolved = "light" | "dark";
const COOKIE = "wb-theme";

export function readThemeCookie(): ThemePref {
  const m = document.cookie.match(/(?:^|; )wb-theme=(light|dark|system)/);
  return (m?.[1] as ThemePref) ?? "system";
}

function writeThemeCookie(t: ThemePref) {
  // One year, whole site, readable by the server so first paint is right without JS.
  document.cookie = `${COOKIE}=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (t: ThemePref): Resolved => (t === "system" ? (media().matches ? "dark" : "light") : t);

const Ctx = createContext<{ pref: ThemePref; resolved: Resolved; setPref: (t: ThemePref) => void }>({
  pref: "system",
  resolved: "light",
  setPref: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readThemeCookie);
  const [resolved, setResolved] = useState<Resolved>(() => resolve(readThemeCookie()));

  useEffect(() => {
    const apply = () => {
      const r = resolve(pref);
      setResolved(r);
      document.documentElement.classList.toggle("dark", r === "dark");
      document.documentElement.dataset.theme = pref;
    };
    apply();
    const m = media();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [pref]);

  const setPref = useCallback((t: ThemePref) => {
    writeThemeCookie(t);
    setPrefState(t);
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** xterm.js palettes for the Zellij web client. Zellij's default theme draws its chrome from this palette too.
 *  xterm cannot read CSS variables, so the ground, ink and selection are tokens.css values as hex: the
 *  card (the terminal is a window body), the foreground, and the brand ramp's soft step for selection
 *  (orange-100 light, orange-900 dark). The ANSI colours are the terminal's own. */
export const terminalThemes: Record<Resolved, Record<string, string>> = {
  dark: {
    background: "#1a1a18", foreground: "#f0efec", cursor: "#f0efec", cursorAccent: "#1a1a18",
    selectionBackground: "#552100",
    black: "#262626", red: "#f87171", green: "#4ade80", yellow: "#facc15", blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#d4d4d4",
    brightBlack: "#525252", brightRed: "#fca5a5", brightGreen: "#86efac", brightYellow: "#fde047", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe", brightCyan: "#67e8f9", brightWhite: "#fafafa",
  },
  light: {
    background: "#ffffff", foreground: "#0a0a0a", cursor: "#0a0a0a", cursorAccent: "#ffffff",
    selectionBackground: "#ffe5d9",
    black: "#171717", red: "#b91c1c", green: "#15803d", yellow: "#a16207", blue: "#1d4ed8", magenta: "#7e22ce", cyan: "#0e7490", white: "#e5e5e5",
    brightBlack: "#525252", brightRed: "#dc2626", brightGreen: "#16a34a", brightYellow: "#ca8a04", brightBlue: "#2563eb", brightMagenta: "#9333ea", brightCyan: "#0891b2", brightWhite: "#f5f5f5",
  },
};
