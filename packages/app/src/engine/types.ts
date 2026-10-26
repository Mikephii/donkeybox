export type RunStatus = "queued" | "starting" | "working" | "blocked" | "idle" | "done" | "failed" | "stopped" | "interrupted";
export const ACTIVE: RunStatus[] = ["starting", "working", "blocked"];
/** interrupted: the box stopped (sleep, redeploy) while the run was live; it can be resumed. */
export const SETTLED: RunStatus[] = ["idle", "done", "failed", "stopped", "interrupted"];

export interface RunRow {
  id: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string | null;
  trigger_event_id: number | null;
  parent_run_id: number | null;
  group_id: string;
  rule_id: string | null;
  title: string;
  prompt: string;
  mode: "interactive" | "print";
  status: RunStatus;
  session_id: string;
  resume_session_id: string | null;
  zellij_session: string | null;
  workdir: string | null;
  worktree: string | null;
  branch: string | null;
  worktree_removed: number;
  repo: string | null;
  goal: string | null;
  goal_iterations: number;
  model: string | null;
  cost_usd: number | null;
  result: string | null;
  error: string | null;
  actor: string | null;
  session_deleted: number;
}

export interface EventRow {
  id: number;
  at: string;
  source: string;
  type: string;
  summary: string | null;
  actor: string | null;
  payload: string;
  run_id: number | null;
  dedupe_key: string | null;
}

export interface RequestAction {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  input?: Record<string, unknown>;
  prompt?: string;
}

export interface RequestRow {
  id: number;
  created_at: string;
  group_id: string;
  title: string;
  body: string;
  actions: string;
  mode: "blocking" | "deferred" | "guard";
  status: "open" | "answered" | "closed";
  origin_run_id: number | null;
  answer: string | null;
  answered_at: string | null;
  answered_by: string | null;
  tool: string | null;
}

export interface Answer {
  action_id: string;
  input: Record<string, unknown>;
  actor: string;
  at: string;
  prompt?: string;
}

export interface Launcher {
  /** Prepare the run directory and start the agent. Must not throw for agent failures, only setup failures. */
  start(run: RunRow): Promise<{ zellij_session?: string; workdir: string }>;
  stop(run: RunRow): Promise<void>;
  steer(run: RunRow, text: string): Promise<void>;
  alive(run: RunRow): Promise<boolean>;
  deleteSession(run: RunRow): Promise<void>;
}

export type SignalKind = "runs" | "requests" | "events" | "services" | "config";
export interface Notifier {
  signal(kind: SignalKind, detail?: Record<string, unknown>): void;
}
