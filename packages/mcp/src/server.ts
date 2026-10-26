// Workbench MCP server (stdio).
// In runs: started per run with WB_RUN_ID; request, note and listing tools only.
// In the human `claude` session (.mcp.json at the repo root, WB_ADMIN=1): setup tools as well.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

const server = new McpServer({ name: "workbench", version: "1.1.0" });
registerTools(server, process.env);
await server.connect(new StdioServerTransport());
