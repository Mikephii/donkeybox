import { createContext, useCallback, useContext } from "react";
import { useSearchParams } from "react-router";
import type { Me } from "@/lib/api";

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);
export type Role = "admin" | "member" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };
/** True when the signed-in person's role is at least `need`. The server checks again on every call. */
export function useCan(need: Role): boolean {
  const me = useContext(MeContext);
  return RANK[(me?.role ?? "member") as Role] >= RANK[need];
}

export type PaneKind = "run" | "request" | "service";

/** The side pane lives in the URL (?pane=run:42), so it is per person, survives reloads and can be linked. */
export function useSidePane() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("pane");
  const [kind, id] = raw ? (raw.split(":") as [PaneKind, string]) : [null, null];
  const open = useCallback(
    (k: PaneKind, i: string | number) =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.set("pane", `${k}:${i}`);
        return n;
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete("pane");
        return n;
      }),
    [setParams],
  );
  return { kind, id, raw, open, close };
}
