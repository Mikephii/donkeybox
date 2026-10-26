import { useEffect } from "react";
import { useLocation } from "react-router";
import { awareness, type Presence } from "./yjs";
import { usePresence } from "./hooks";

/**
 * What a person is looking at, as subject keys: "canvas:work", "run:42", "request:7",
 * "workflow:jira-tickets", or "page:/sources". A run open in a canvas side pane counts as "run:42" too.
 */
export function subjectsFor(pathname: string, search: string): string[] {
  const out: string[] = [];
  const m = pathname.match(/^\/(c|runs|requests|workflows)\/([^/]+)/);
  const kinds: Record<string, string> = { c: "canvas", runs: "run", requests: "request", workflows: "workflow" };
  if (m) out.push(`${kinds[m[1]!]}:${decodeURIComponent(m[2]!)}`);
  else out.push(`page:${pathname}`);
  const pane = new URLSearchParams(search).get("pane");
  if (pane) out.push(pane);
  return out;
}

export function useReportLocation() {
  const loc = useLocation();
  useEffect(() => {
    awareness.setLocalStateField("subjects", subjectsFor(loc.pathname, loc.search));
    if (!loc.pathname.startsWith("/c/")) awareness.setLocalStateField("cursor", null);
  }, [loc.pathname, loc.search]);
}

/** Other people currently on this subject. */
export function useOthersOn(subject: string): Presence[] {
  const states = usePresence();
  const seen = new Map<string, Presence>();
  for (const [cid, s] of states) {
    if (cid === awareness.clientID || !s.user) continue;
    if ((s as Presence & { subjects?: string[] }).subjects?.includes(subject)) seen.set(s.user.email, s);
  }
  return [...seen.values()];
}
