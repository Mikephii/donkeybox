// Browser API client. In dev, `?as=alice` on any URL sets this tab's identity (sent as x-wb-as).
const AS_KEY = "wb-as";

export function initIdentityOverride() {
  const params = new URLSearchParams(location.search);
  const as = params.get("as");
  if (as) {
    sessionStorage.setItem(AS_KEY, as);
    // Iframes and websockets cannot send x-wb-as; the dev door reads this cookie instead.
    document.cookie = `wb-dev-as=${encodeURIComponent(as)}; Path=/; SameSite=Lax`;
    params.delete("as");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
  }
}

export const identityOverride = () => sessionStorage.getItem(AS_KEY) ?? undefined;

export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const as = identityOverride();
  if (as) headers["x-wb-as"] = as;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await r.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  // The box's own sign-in (OIDC): go there and come back to this page.
  if (r.status === 401 && data?.login) {
    window.location.href = `${data.login}?next=${encodeURIComponent(location.pathname + location.search)}`;
    await new Promise(() => {});
  }
  if (!r.ok) throw new ApiError(r.status, data?.error ?? (data?.errors ? "validation failed" : `HTTP ${r.status}`), data?.errors ?? []);
  return data as T;
}

export interface Me { email: string; name: string; authMode: string; role?: "admin" | "member" | "viewer" }

export interface Run {
  id: number; title: string; prompt: string; group_id: string; status: string; mode: string; created_at: string;
  started_at: string | null; ended_at: string | null; cost_usd: number | null; model: string | null; zellij_session: string | null;
  session_deleted: number; repo?: string | null; branch?: string | null; worktree?: string | null; worktree_removed?: number; trigger_summary?: string | null; trigger_event_id: number | null; parent_run_id: number | null;
  goal: string | null; goal_iterations: number; error: string | null; result: string | null; open_requests?: number;
  workdir: string | null; session_id: string; actor: string | null;
}

export interface Action { id: string; label: string; style?: "primary" | "secondary" | "danger"; input?: Record<string, any>; prompt?: string }

export interface Req {
  id: number; group_id: string; title: string; body: string; actions: Action[]; mode: "blocking" | "deferred" | "guard";
  status: "open" | "answered" | "closed"; origin_run_id: number | null; created_at: string;
  answer: { action_id: string; input: Record<string, unknown>; actor: string; at: string; prompt?: string } | null;
  tool: { name: string; input: unknown; pattern: string } | null;
}

export interface Ev { id: number; at: string; source: string; type: string; summary: string | null; actor: string | null; payload: string; run_id: number | null }
export interface GroupInfo { id: string; title: string; description?: string; autonomy: string; open: number }
export interface ServiceStatus { id: string; title: string; unit?: string; state: string; pid?: number; since?: string; restarts?: number; canRestart: boolean; detail?: string }
