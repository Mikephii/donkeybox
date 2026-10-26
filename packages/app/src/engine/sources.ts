import { createHmac, timingSafeEqual } from "node:crypto";
import { sourceKind, type Source } from "./config.ts";
import { getPath, pick, render } from "./template.ts";

export interface NormalizedEvent {
  type: string;
  summary: string;
  actor?: string;
  payload: Record<string, unknown>;
}

export interface InboundRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: unknown;
  /** The request path, needed for url-token sources. */
  path?: string;
}

const header = (req: InboundRequest, name: string): string | undefined => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type Secrets = (name: string) => string | undefined;

/** Returns null when the request is authentic, otherwise a reason. Runs before the body is interpreted. */
export function verify(source: Source, req: InboundRequest, secrets: Secrets): string | null {
  const v = source.verify;
  if (!v) return "source has no verifier";
  if (v.kind === "none") return null;
  const secret = secrets(v.secret);
  if (!secret) return `secret ${v.secret} is not set`;
  if (v.kind === "hmac") {
    const sig = header(req, v.header);
    if (!sig) return `missing ${v.header}`;
    const expected = v.prefix + createHmac(v.algorithm, secret).update(req.rawBody).digest("hex");
    return safeEqual(sig, expected) ? null : "bad signature";
  }
  if (v.kind === "url-token") {
    const token = (req.path ?? "").split("?")[0]!.replace(/\/+$/, "").split("/").pop() ?? "";
    return safeEqual(token, secret) ? null : "bad URL token";
  }
  const got = header(req, v.header);
  if (!got) return `missing ${v.header}`;
  return safeEqual(got, secret) ? null : "bad secret";
}

/** A stable id for retries, so the same delivery never runs twice. */
export function deliveryId(source: Source, req: InboundRequest): string | undefined {
  if (source.adapter === "github") return header(req, "x-github-delivery");
  return header(req, "x-delivery-id") ?? header(req, "x-request-id");
}

type Adapter = (req: InboundRequest) => NormalizedEvent | null;

const githubAdapter: Adapter = (req) => {
  const event = header(req, "x-github-event") ?? "unknown";
  const b = (req.body ?? {}) as Record<string, any>;
  if (event === "ping") return null;
  const repo = b.repository?.full_name ?? b.repository?.name;
  const actor = b.sender?.login;
  if (event === "pull_request") {
    const pr = b.pull_request ?? {};
    const merged = b.action === "closed" && pr.merged === true;
    const action = merged ? "merged" : b.action;
    const payload = {
      repo,
      number: pr.number ?? b.number,
      title: pr.title,
      author: pr.user?.login,
      branch: pr.head?.ref,
      base: pr.base?.ref,
      url: pr.html_url,
      merged_by: pr.merged_by?.login,
    };
    const verb = merged ? "merged" : String(b.action ?? "updated").replace(/_/g, " ");
    return { type: `github.pull_request.${action}`, summary: `PR #${payload.number} ${verb}: ${payload.title ?? ""} (${repo})`, actor, payload };
  }
  if (event === "push") {
    const payload = { repo, ref: b.ref, before: b.before, after: b.after, commits: (b.commits ?? []).length, pusher: b.pusher?.name };
    return { type: "github.push", summary: `${payload.commits} commit(s) pushed to ${b.ref} (${repo})`, actor, payload };
  }
  if (event === "issues" || event === "issue_comment") {
    const issue = b.issue ?? {};
    const payload = { repo, number: issue.number, title: issue.title, url: issue.html_url, comment: b.comment?.body };
    return { type: `github.${event}.${b.action}`, summary: `Issue #${issue.number} ${b.action}: ${issue.title ?? ""} (${repo})`, actor, payload };
  }
  return { type: `github.${event}${b.action ? "." + b.action : ""}`, summary: `GitHub ${event} ${b.action ?? ""} (${repo ?? "?"})`, actor, payload: { repo, action: b.action } };
};

const jiraAdapter: Adapter = (req) => {
  const b = (req.body ?? {}) as Record<string, any>;
  const raw: string = b.webhookEvent ?? "jira:unknown";
  // jira:issue_created -> jira.issue.created, comment_created -> jira.comment.created
  const m = raw.replace(/^jira:/, "").match(/^([a-z]+)_(.+)$/);
  const type = m ? `jira.${m[1]}.${m[2]}` : `jira.${raw.replace(/^jira:/, "")}`;
  const issue = b.issue ?? {};
  const fields = issue.fields ?? {};
  const payload = {
    key: issue.key,
    summary: fields.summary,
    status: fields.status?.name,
    type: fields.issuetype?.name,
    project: fields.project?.key,
    assignee: fields.assignee?.displayName,
    comment: b.comment?.body,
  };
  const actor = b.user?.displayName ?? b.user?.emailAddress;
  const verb = (m?.[2] ?? "event").replace(/_/g, " ");
  return { type, summary: `${issue.key ?? "Jira"} ${verb}: ${fields.summary ?? ""}`, actor, payload };
};

export const adapters: Record<string, Adapter> = { github: githubAdapter, jira: jiraAdapter };

/** Generic sources take {type, summary, payload} as sent, for your own scripts and CI. */
function generic(req: InboundRequest): NormalizedEvent | null {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.type !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(b.type)) return null;
  const payload = b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? (b.payload as Record<string, unknown>) : {};
  return { type: b.type, summary: typeof b.summary === "string" ? b.summary.slice(0, 300) : b.type, actor: typeof b.actor === "string" ? b.actor : undefined, payload };
}

export function normalize(source: Source, req: InboundRequest): NormalizedEvent | null {
  if (sourceKind(source) === "generic") return generic(req);
  if (source.adapter) return adapters[source.adapter]!(req);
  if (source.map) {
    const payload: Record<string, unknown> = {};
    for (const [k, expr] of Object.entries(source.map.payload)) payload[k] = pick(req.body, expr);
    const summary = source.map.summary ? render(source.map.summary, { payload }) : source.map.type;
    return { type: source.map.type, summary, payload };
  }
  return null;
}

/** Finds the source for a request path. url-token sources match their path plus one more segment (the token). */
export function findSourceByPath(sources: Record<string, Source>, path: string): [string, Source] | null {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  for (const [id, s] of Object.entries(sources)) {
    if (!s.path) continue;
    const base = s.path.replace(/\/+$/, "");
    if (s.verify?.kind === "url-token") {
      if (clean.startsWith(`${base}/`) && !clean.slice(base.length + 1).includes("/")) return [id, s];
    } else if (base === clean) return [id, s];
  }
  return null;
}

export { getPath };
