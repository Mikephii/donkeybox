// A stand-in for the Atlassian MCP server, reached on the demo network as mcp.atlassian.com. It speaks
// MCP's streamable HTTP transport with plain JSON replies and needs no sign-in, so the MCP clip can
// add it, see it connect and import it into a workflow without a real Atlassian site.
import type { IncomingMessage, ServerResponse } from "node:http";

const TOOLS = [
  ["getJiraIssue", "Get a Jira issue by key, with its fields and comments."],
  ["searchJiraIssuesUsingJql", "Search Jira issues with JQL."],
  ["createJiraIssue", "Create a Jira issue in a project."],
  ["editJiraIssue", "Edit fields on a Jira issue."],
  ["addCommentToJiraIssue", "Add a comment to a Jira issue."],
  ["transitionJiraIssue", "Move a Jira issue to another status."],
  ["getConfluencePage", "Get a Confluence page by id."],
  ["searchConfluenceUsingCql", "Search Confluence with CQL."],
] as const;

const ISSUES: Record<string, string> = {
  "DK-42": "DK-42 Export orders to CSV and email it weekly (Story, To Do)",
  "DK-43": "DK-43 CSV export endpoint for orders (Story, In Progress, 3 points)",
  "DK-44": "DK-44 Weekly orders email with the CSV attached (Story, To Do, 2 points)",
};

function result(name: string, args: Record<string, any>) {
  if (name === "getJiraIssue") return ISSUES[args.issueIdOrKey ?? args.key] ?? `No issue ${args.issueIdOrKey ?? args.key}`;
  if (name === "searchJiraIssuesUsingJql") return Object.values(ISSUES).join("\n");
  if (name === "addCommentToJiraIssue") return `Comment added to ${args.issueIdOrKey ?? args.key}`;
  return "OK";
}

export async function mcp(req: IncomingMessage, res: ServerResponse, raw: string) {
  if (req.method === "GET") return void res.writeHead(405).end();
  if (req.method === "DELETE") return void res.writeHead(200).end();
  const msg = JSON.parse(raw || "{}");
  const one = (m: any) => {
    if (m.id === undefined) return null;
    const ok = (r: unknown) => ({ jsonrpc: "2.0", id: m.id, result: r });
    switch (m.method) {
      case "initialize":
        return ok({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "atlassian", version: "1.0.0" } });
      case "tools/list":
        return ok({ tools: TOOLS.map(([name, description]) => ({ name, description, inputSchema: { type: "object", properties: { issueIdOrKey: { type: "string" }, jql: { type: "string" }, body: { type: "string" } } } })) });
      case "tools/call":
        return ok({ content: [{ type: "text", text: result(m.params.name, m.params.arguments ?? {}) }] });
      case "ping":
        return ok({});
      default:
        return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `no method ${m.method}` } };
    }
  };
  const out = Array.isArray(msg) ? msg.map(one).filter(Boolean) : one(msg);
  if (!out || (Array.isArray(out) && !out.length)) return void res.writeHead(202).end();
  res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "demo-session" }).end(JSON.stringify(out));
}
