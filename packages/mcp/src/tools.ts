import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Admin (setup) tools are for the human `claude` session only. A triggered run always has
 * WB_RUN_ID set, so it never gets them, whatever else is in its environment.
 */
export function adminAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.WB_ADMIN === "1" && !env.WB_RUN_ID;
}

export function readAdminToken(env: NodeJS.ProcessEnv): string | null {
  if (env.WB_ADMIN_TOKEN) return env.WB_ADMIN_TOKEN;
  const root = resolve(env.WB_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
  const file = join(env.WB_DATA_DIR ?? join(root, "data"), "admin.token");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

export function registerTools(server: McpServer, env: NodeJS.ProcessEnv = process.env) {
const api = env.WB_LOCAL_API ?? "http://127.0.0.1:8001";
const runId = env.WB_RUN_ID ? Number(env.WB_RUN_ID) : null;

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error ?? (data?.errors ?? []).join("; ") ?? `HTTP ${r.status}`);
  return data;
}

async function runGroup(): Promise<string | undefined> {
  if (!runId) return undefined;
  return (await call("GET", `/runs/${runId}`)).group_id;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const action = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).describe("machine id, e.g. approve"),
  label: z.string().describe("button text"),
  style: z.enum(["primary", "secondary", "danger"]).optional(),
  input: z.record(z.string(), z.union([z.enum(["string", "text", "number", "boolean"]), z.object({ enum: z.array(z.string()) })])).optional()
    .describe("optional form fields shown when this button is pressed, e.g. {\"note\":\"text\"}"),
  prompt: z.string().optional().describe("template sent back when this action is chosen; may use {{request.id}}, {{request.title}}, {{input.<field>}}"),
});

const requestShape = {
  title: z.string().describe("short title shown in the queue"),
  body: z.string().describe("markdown body: what you want to do and why"),
  group: z.string().optional().describe("group id; defaults to this run's group"),
  actions: z.array(action).optional().describe("buttons to offer; defaults to the group's actions"),
};


server.registerTool(
  "create_request",
  {
    description:
      "Raise a request in a workbench queue for humans to answer, then END YOUR TURN. When someone presses a button, this conversation resumes with their answer as a new prompt. Use for decisions that can wait.",
    inputSchema: requestShape,
  },
  async (a) => {
    const group = a.group ?? (await runGroup());
    const r = await call("POST", "/requests", { ...a, group, mode: "deferred", run_id: runId });
    return text(`Request #${r.id} raised in ${group}. End your turn now; the answer will arrive as a new message in this conversation.`);
  },
);

server.registerTool(
  "ask_humans",
  {
    description:
      "Raise a request in a workbench queue and WAIT for a human to press a button. Returns the chosen action, any form input, and the follow-up instruction. Use for quick decisions you need before continuing.",
    inputSchema: { ...requestShape, timeout_minutes: z.number().min(1).max(1440).optional().describe("default 60") },
  },
  async (a) => {
    const group = a.group ?? (await runGroup());
    const r = await call("POST", "/requests", { title: a.title, body: a.body, group, actions: a.actions, mode: "blocking", run_id: runId });
    const until = Date.now() + (a.timeout_minutes ?? 60) * 60_000;
    while (Date.now() < until) {
      const s = await call("GET", `/requests/${r.id}/answer?wait=1&timeout=25`);
      if (s.status === "answered") {
        const ans = s.answer;
        const label = s.actions.find((x: any) => x.id === ans.action_id)?.label ?? ans.action_id;
        return text(
          `${ans.actor} chose "${label}" (${ans.action_id}) on request #${r.id}.` +
            (Object.keys(ans.input ?? {}).length ? `\nInput: ${JSON.stringify(ans.input)}` : "") +
            (ans.prompt ? `\nInstruction: ${ans.prompt}` : ""),
        );
      }
      if (s.status === "closed") return text(`Request #${r.id} was closed without an answer.`);
    }
    await call("PATCH", `/requests/${r.id}`, { mode: "deferred" });
    return text(`No answer within the timeout. Request #${r.id} stays open; end your turn and the answer will resume this conversation.`);
  },
);

server.registerTool(
  "note",
  { description: "Post a short progress note to this run's timeline in the workbench UI.", inputSchema: { text: z.string() } },
  async (a) => {
    await call("POST", "/notes", { text: a.text, run_id: runId });
    return text("noted");
  },
);

server.registerTool(
  "list_requests",
  {
    description: "List workbench requests, e.g. to see what is still open or what was answered.",
    inputSchema: { status: z.enum(["open", "answered", "closed"]).optional(), group: z.string().optional() },
  },
  async (a) => {
    const qs = new URLSearchParams();
    if (a.status) qs.set("status", a.status);
    if (a.group) qs.set("group", a.group);
    const rows = await call("GET", `/requests?${qs}`);
    return text(
      rows.length
        ? rows.map((r: any) => `#${r.id} [${r.status}] (${r.group_id}) ${r.title}${r.answer ? ` → ${r.answer.action_id} by ${r.answer.actor}` : ""}`).join("\n")
        : "no requests",
    );
  },
);

server.registerTool("list_groups", { description: "List workbench groups (queues) and their autonomy policy.", inputSchema: {} }, async () => {
  const groups = await call("GET", "/groups");
  return text(Object.entries(groups).map(([id, g]: [string, any]) => `${id}: ${g.title} (${g.autonomy})${g.description ? ` - ${g.description}` : ""}`).join("\n"));
});


  if (adminAllowed(env)) registerAdminTools(server, api, readAdminToken(env));
}

const REFERENCE = `# Workbench setup reference

Everything is a workflow (a group in the workspace's config.json) plus a skill (<skillsDir>/<name>/SKILL.md, by default .claude/skills).

Workflow (group) fields: title, description, skill (skill name = slash command), autonomy
("autonomous" | "ask-first" | "guarded"), guard (Claude permission patterns that pause for a person,
e.g. "Bash(jira delete*)", "mcp__jira__delete_*"), notify (emails that get a toast), actions
(buttons: {id, label, style: primary|secondary|danger, input?: {field: "string"|"text"|"number"|"boolean"|{enum:[...]}},
prompt?: template sent back to the agent, e.g. "/email-jeff send {{request.id}}" or "{{input.note}}"}),
model (e.g. "haiku"), allowedTools (e.g. ["Bash(mail:*)"]), mcpServers ({name: {type:"stdio",command,args,env} |
{type:"http",url,headers}}; put tokens as "\${secret:NAME}"), workdir (folder runs start in, absolute or relative
to the workspace; empty = a fresh folder per run), addDirs (more folders runs may use), webAccess (default true; false denies WebSearch and WebFetch), parallel, extraSkillDirs, pluginDirs.
How runs use people's code repos (clone, branch, worktree, push) is up to the skill; the workbench does not manage code repos.

Rule: {id, on: event type glob, filter: {payload.path: value}, prompt: slash command with {{payload.x}},
group, mode: "interactive"|"print", goal?: shell check, title?, enabled}.

Source kinds:
- webhook from a service: {title, path: "/hooks/<name>", verify, adapter: "github"|"jira" OR map: {type, summary?, payload: {key: "$.path"}}}
- generic (your scripts, CI): {kind: "generic", title, path, verify}; the sender posts {type, summary?, payload?, actor?}
- schedule: {title, schedule: cron, type, payload?}
Verifiers: {kind:"hmac", secret} (GitHub; header/algorithm/prefix default to GitHub's), {kind:"header", header, secret},
{kind:"url-token", secret} (Jira Cloud and anything that cannot set headers), {kind:"none"} (testing only).
"secret" is always a secret NAME from list_secrets, never a value. People create values on the Secrets page.

Terminals: new_terminal {title, cwd: "workspace" | a folder, command?}.
The workspace is the box's own config repo, not anyone's code. Changes made through these tools are committed for you; commit any edit you make to its files directly, with a message that says what changed.

Skill: markdown starting with frontmatter "---\nname: <same as folder>\ndescription: <when to use>\n---".
Tell the agent what each slash-command argument and each action prompt means.

Windows (canvas views): types terminal {session}, requests {groups: [ids], status}, runs {live},
services, preview {port, path}, code {target: "all"|"workspace"|"home"|"box"}, devtools, activity,
doc {path} (a markdown file shown rendered and kept up to date; open_document puts one beside the person's terminal).
Canvases start locked for people; admin tools can still add windows.

Typical "connect a system" recipe: have the person add and sign in to its MCP server with
"claude mcp add" in a terminal, copy that server (same name and URL) into the group's mcpServers,
write the skill, add actions, guard destructive tools, add a source for its webhook with a verifier
the sender supports, add a rule from that source's event type to the group, then add a requests window
filtered to the group.`;

function registerAdminTools(server: McpServer, api: string, token: string | null) {
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    if (!token) throw new Error("admin token not found (data/admin.token); start the workbench app first");
    const r = await fetch(`${api}/admin${path}`, {
      method,
      headers: { "x-wb-admin-token": token, ...(process.env.WB_ACTOR ? { "x-wb-actor": process.env.WB_ACTOR } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    const d = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error([d?.error ?? `HTTP ${r.status}`, ...(d?.errors ?? [])].join("\n"));
    return d;
  };
  const json = (x: unknown) => ({ content: [{ type: "text" as const, text: typeof x === "string" ? x : JSON.stringify(x, null, 2) }] });
  const tool = (name: string, description: string, inputSchema: Record<string, z.ZodTypeAny>, fn: (a: any) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema }, async (a: any) => json(await fn(a)));

  tool("setup_reference", "Read this first: the shapes of workflows, actions, rules, sources, skills and windows, and the recipe for connecting a system.", {}, async () => REFERENCE);
  tool("list_workflows", "List workflows (groups) with their skill, autonomy, rule and open-request counts.", {}, () => call("GET", "/workflows"));
  tool("get_workflow", "Everything about one workflow: settings, actions, rules, feeding sources and skill text.", { id: z.string() }, (a) => call("GET", `/workflows/${a.id}`));
  tool(
    "upsert_workflow",
    "Create or replace a workflow's settings. On create, skill:true writes a starter skill and rule adds a rule that starts it.",
    { id: z.string(), group: z.record(z.string(), z.unknown()), skill: z.union([z.boolean(), z.string()]).optional(), rule: z.record(z.string(), z.unknown()).optional() },
    (a) => call("PUT", `/workflows/${a.id}`, { group: a.group, skill: a.skill, rule: a.rule }),
  );
  tool("delete_workflow", "Delete a workflow. Refused while rules still start it.", { id: z.string(), delete_skill: z.boolean().optional() }, (a) => call("DELETE", `/workflows/${a.id}${a.delete_skill ? "?skill=1" : ""}`));
  tool("list_skills", "List skills in the workspace skills folder.", {}, () => call("GET", "/skills"));
  tool("read_skill", "Read a skill's SKILL.md.", { name: z.string() }, (a) => call("GET", `/skills/${a.name}`));
  tool("write_skill", "Create or replace <skillsDir>/<name>/SKILL.md in the workspace. Must start with frontmatter whose name matches.", { name: z.string(), content: z.string() }, (a) => call("PUT", `/skills/${a.name}`, { content: a.content }));
  tool("list_rules", "List all rules.", {}, () => call("GET", "/rules"));
  tool("upsert_rule", "Create or replace a rule (event type to prompt in a group).", { rule: z.record(z.string(), z.unknown()) }, (a) => call("PUT", `/rules/${a.rule.id}`, a.rule));
  tool("delete_rule", "Delete a rule.", { id: z.string() }, (a) => call("DELETE", `/rules/${a.id}`));
  tool("list_sources", "List sources with their URLs, what they emit and which rules they feed.", {}, () => call("GET", "/sources"));
  tool("list_terminals", "List terminal sessions: standing ones from config, ones people opened (with who), and live run sessions.", {}, () => call("GET", "/terminals"));
  tool("new_terminal", "Open a terminal session for the person you are helping. cwd is 'workspace' or a folder; command runs first, then a shell stays open. Add a Terminal window with add_window to show it on a canvas.", { title: z.string(), cwd: z.string().optional(), command: z.string().optional() }, (a) => call("POST", "/terminals", a));
  tool("close_terminal", "End a terminal session someone opened (not standing or run sessions).", { name: z.string() }, (a) => call("DELETE", `/terminals/${a.name}`));
  tool("list_secrets", "List secret names, whether each is set (store or environment) and where config.json uses it. Values are never returned; a person creates them on the Secrets page or with `wb secrets`.", {}, () => call("GET", "/secrets"));
  tool("upsert_source", "Create or replace a webhook or schedule source. verify.secret is a secret NAME from list_secrets, never a value.", { id: z.string(), source: z.record(z.string(), z.unknown()) }, (a) => call("PUT", `/sources/${a.id}`, { source: a.source }));
  tool("delete_source", "Delete a source.", { id: z.string() }, (a) => call("DELETE", `/sources/${a.id}`));
  tool("test_source", "Send a signed sample delivery through the webhook listener. Rules do not run unless trigger_rules is true.", { id: z.string(), trigger_rules: z.boolean().optional() }, (a) => call("POST", `/sources/${a.id}/test`, { triggerRules: a.trigger_rules === true }));
  tool("list_canvases", "List canvases.", {}, () => call("GET", "/canvases"));
  tool("upsert_canvas", "Create or rename a canvas.", { id: z.string(), title: z.string(), locked: z.boolean().optional() }, (a) => call("PUT", `/canvases/${a.id}`, { title: a.title, locked: a.locked }));
  tool("delete_canvas", "Delete a canvas and its windows. Ask the person first; canvases are shared.", { id: z.string() }, (a) => call("DELETE", `/canvases/${a.id}`));
  tool("list_windows", "List windows, optionally on one canvas.", { canvas: z.string().optional() }, (a) => call("GET", `/windows${a.canvas ? `?canvas=${a.canvas}` : ""}`));
  tool(
    "upsert_window",
    "Add or update a window on a canvas, e.g. a requests window filtered to a group. Omit id to add; placement is automatic.",
    {
      id: z.string().optional(), canvasId: z.string(),
      type: z.enum(["terminal", "requests", "runs", "services", "preview", "devtools", "activity", "code", "doc"]),
      title: z.string().optional(), description: z.string().optional(), props: z.record(z.string(), z.unknown()).optional(),
    },
    (a) => (a.id ? call("PUT", `/windows/${a.id}`, a) : call("POST", "/windows", a)),
  );
  tool(
    "open_document",
    "Show a markdown file (.md under the workspace, home or /tmp) as a Document window beside the person's terminal, rendered and kept up to date. Use it for anything they should read: a proposal, a plan, a table, a report.",
    { path: z.string(), title: z.string().optional() },
    (a) => call("POST", "/docs/open", { path: a.path, title: a.title, session: process.env.ZELLIJ_SESSION_NAME }),
  );
  tool("delete_window", "Remove a window.", { id: z.string() }, (a) => call("DELETE", `/windows/${a.id}`));
}
