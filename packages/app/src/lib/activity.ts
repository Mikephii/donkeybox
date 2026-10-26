/**
 * When the box last saw each kind of activity, so a host can decide to stop it while nobody uses it.
 * person: someone changed something; view: someone has a page open (polling); terminal: someone opened
 * a terminal; delivery: a webhook arrived; run: a run is live (reported as now while one is).
 */
export type ActivityKind = "person" | "view" | "terminal" | "delivery" | "run";

export class ActivityClock {
  last: Record<ActivityKind, string | null> = { person: null, view: null, terminal: null, delivery: null, run: null };
  readonly startedAt = new Date().toISOString();
  touch(kind: ActivityKind) {
    this.last[kind] = new Date().toISOString();
  }
  /** Latest of everything except page views, which an idle open tab keeps fresh forever. */
  summary(liveRuns: number) {
    if (liveRuns > 0) this.touch("run");
    const busy = (["person", "terminal", "delivery", "run"] as ActivityKind[]).map((k) => this.last[k]).filter(Boolean).sort().at(-1) ?? null;
    return { lastActivity: busy, byKind: { ...this.last }, liveRuns, startedAt: this.startedAt };
  }
}
