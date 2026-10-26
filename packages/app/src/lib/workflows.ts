import { Cron } from "croner";
import { createHmac, randomUUID } from "node:crypto";
import { sourceKind, type Config, type Group, type Rule, type Source } from "../engine/config.ts";
import { globToRegex } from "../engine/guard.ts";

/** What event types a source can emit: an exact type, or a prefix for adapters. */
export function sourceEmits(s: Source): { exact?: string; prefix?: string; any?: boolean } {
  if (sourceKind(s) === "generic") return { any: true };
  if (s.schedule) return { exact: s.type };
  if (s.map) return { exact: s.map.type };
  if (s.adapter) return { prefix: `${s.adapter}.` };
  return {};
}

/** True when events from this source can match the rule's `on` pattern. */
export function sourceFeedsRule(s: Source, rule: Rule): boolean {
  const e = sourceEmits(s);
  if (e.any) return true;
  const re = globToRegex(rule.on);
  if (e.exact) return re.test(e.exact);
  if (e.prefix) {
    if (rule.on.startsWith(e.prefix)) return true;
    // e.g. rule "*.merged" or "*": test a representative type from the prefix
    return re.test(`${e.prefix}x`) || re.test(`${e.prefix}pull_request.merged`) || re.test(`${e.prefix}issue.created`);
  }
  return false;
}

export function rulesForGroup(c: Config, id: string): Rule[] {
  return c.rules.filter((r) => r.group === id);
}

export function sourcesForRules(c: Config, rules: Rule[]): { id: string; source: Source; rules: string[] }[] {
  return Object.entries(c.sources)
    .map(([id, source]) => ({ id, source, rules: rules.filter((r) => sourceFeedsRule(source, r)).map((r) => r.id) }))
    .filter((x) => x.rules.length > 0);
}

export function nextRun(s: Source): string | null {
  if (!s.schedule) return null;
  try {
    return new Cron(s.schedule).nextRun()?.toISOString() ?? null;
  } catch {
    return null;
  }
}

export const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function workflowSummary(c: Config, id: string, g: Group, open: number) {
  return { id, title: g.title, description: g.description ?? "", autonomy: g.autonomy, skill: g.skill ?? null, open, rules: rulesForGroup(c, id).length, actions: g.actions.length };
}

// ───────────── test deliveries ─────────────

/** A plausible body for a source, so test-send exercises the real verifier and adapter or map. */
export function sampleDelivery(id: string, s: Source): { body: unknown; headers: Record<string, string> } {
  const delivery = `test-${randomUUID()}`;
  if (sourceKind(s) === "generic")
    return { headers: { "x-delivery-id": delivery }, body: { type: `${id}.test`, summary: "Test delivery from the workbench", payload: { test: true } } };
  if (s.adapter === "github") {
    const n = 4242;
    return {
      headers: { "x-github-event": "pull_request", "x-github-delivery": delivery },
      body: {
        action: "closed", number: n,
        pull_request: { number: n, title: "Test delivery from the workbench", merged: true, html_url: `https://github.com/example/shop/pull/${n}`, user: { login: "octocat" }, merged_by: { login: "octocat" }, head: { ref: "test/branch" }, base: { ref: "main" } },
        repository: { full_name: "example/shop", name: "shop" }, sender: { login: "octocat" },
      },
    };
  }
  if (s.adapter === "jira") {
    return {
      headers: { "x-delivery-id": delivery },
      body: { webhookEvent: "jira:issue_created", user: { displayName: "Workbench test" }, issue: { key: "TEST-1", fields: { summary: "Test delivery from the workbench", status: { name: "To Do" }, issuetype: { name: "Task" }, project: { key: "TEST" } } } },
    };
  }
  // Declarative map: build a body that contains every $.path the map reads.
  const body: Record<string, any> = {};
  for (const [k, expr] of Object.entries(s.map?.payload ?? {})) {
    if (!expr.startsWith("$.")) continue;
    const parts = expr.slice(2).split(".");
    let cur = body;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] = `sample-${k}`;
      else cur = cur[p] ??= {};
    });
  }
  return { headers: { "x-delivery-id": delivery }, body: Object.keys(body).length ? body : { test: true, source: id } };
}

/** Adds whatever the source's verifier checks, exactly as a real sender would: a signature, a header or a URL token. */
export function signDelivery(s: Source, raw: string, headers: Record<string, string>, secret: string | undefined): { headers: Record<string, string>; path: string } {
  const v = s.verify;
  const path = s.path!;
  if (!v || v.kind === "none") return { headers, path };
  if (!secret) throw new Error(`secret ${v.secret} is not set; create it on the Secrets page`);
  if (v.kind === "hmac") return { headers: { ...headers, [v.header.toLowerCase()]: v.prefix + createHmac(v.algorithm, secret).update(raw).digest("hex") }, path };
  if (v.kind === "url-token") return { headers, path: `${path.replace(/\/+$/, "")}/${secret}` };
  return { headers: { ...headers, [v.header.toLowerCase()]: secret }, path };
}

/** The URL a sender should use. For url-token sources the token is shown as a placeholder, never the value. */
export function displayPath(s: Source): string | null {
  if (!s.path) return null;
  return s.verify?.kind === "url-token" ? `${s.path.replace(/\/+$/, "")}/<token>` : s.path;
}
