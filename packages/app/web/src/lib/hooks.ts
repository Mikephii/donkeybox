import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { api } from "./api";
import { awareness, signals, type Presence } from "./yjs";

/** Subscribes to a Y.Map and returns a snapshot that changes identity on every update. */
export function useYMap<T>(map: Y.Map<T>): Map<string, T> {
  const ref = useRef<Map<string, T>>(new Map(map.entries()));
  const subscribe = useCallback(
    (cb: () => void) => {
      const h = () => {
        ref.current = new Map(map.entries());
        cb();
      };
      map.observe(h);
      return () => map.unobserve(h);
    },
    [map],
  );
  return useSyncExternalStore(subscribe, () => ref.current);
}

/** Counter that bumps whenever the server signals a change to one of `kinds`. */
export function useSignal(kinds: string[]): number {
  const key = kinds.join(",");
  const read = () => kinds.reduce((n, k) => n + (signals.get(k)?.n ?? 0), 0);
  const [v, setV] = useState(read);
  useEffect(() => {
    const h = () => setV(read());
    signals.observe(h);
    return () => signals.unobserve(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v;
}

/** GET that refetches on server signals, with a slow poll as a fallback if Yjs is down. */
export function useApi<T>(path: string | null, kinds: string[], pollMs = 15_000) {
  const tick = useSignal(kinds);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const t = setTimeout(() => {
      api<T>(path)
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message));
    }, 30);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [path, tick, n]);
  useEffect(() => {
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  return { data, error, reload };
}

export function usePresence(): Map<number, Presence> {
  const [states, setStates] = useState(() => new Map(awareness.getStates() as Map<number, Presence>));
  useEffect(() => {
    const h = () => setStates(new Map(awareness.getStates() as Map<number, Presence>));
    awareness.on("change", h);
    return () => awareness.off("change", h);
  }, []);
  return states;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function duration(from: string | null, to: string | null, now = Date.now()): string {
  if (!from) return "";
  const end = to ? Date.parse(to) : now;
  const s = Math.max(0, Math.round((end - Date.parse(from)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
