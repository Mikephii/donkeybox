// The demo's model: a stand-in for the Anthropic Messages API that plays scripted turns, so the real
// Claude Code and OpenCode run on the box, call real tools, and every take comes out the same.
// It also serves a small MCP server (the "Atlassian" one in the MCP clip) over HTTPS.
//   node demo/model/server.ts                 # http on :4999 (model), https on :443 (mcp) if certs exist
// Point a client at it with ANTHROPIC_BASE_URL=http://model:4999 and any ANTHROPIC_API_KEY.
// With DEMO_MODEL=real and a real ANTHROPIC_API_KEY it forwards everything to api.anthropic.com instead.
import { createServer as http, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as https } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pick, type Step } from "./scenarios.ts";
import { mcp } from "./mcp.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4999);
const REAL = process.env.DEMO_MODEL === "real";
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const body = (req: IncomingMessage) =>
  new Promise<string>((res) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => res(s));
  });

type Block = { type: string; text?: string; content?: unknown; [k: string]: unknown };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

const textOf = (c: Msg["content"]): string =>
  typeof c === "string" ? c : c.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n");
const isToolResult = (m: Msg) => typeof m.content !== "string" && m.content.some((b) => b.type === "tool_result");

/** The prompt that started the current exchange, and how many assistant turns have followed it. */
function position(messages: Msg[]) {
  let i = messages.length - 1;
  while (i >= 0 && !(messages[i]!.role === "user" && !isToolResult(messages[i]!))) i--;
  // Without Claude Code's system reminders: they list every skill on the box, which would match too.
  const prompt = i >= 0 ? textOf(messages[i]!.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "") : "";
  const turn = messages.slice(i + 1).filter((m) => m.role === "assistant").length;
  const lastResult = messages.at(-1) && isToolResult(messages.at(-1)!) ? JSON.stringify(messages.at(-1)!.content) : "";
  // Every tool result since the prompt, for steps that need what an earlier one printed (new ticket keys).
  const history = messages.slice(i + 1).filter(isToolResult).map((m) => JSON.stringify(m.content)).join("\n");
  const all = messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  return { prompt, turn, lastResult, history, all };
}

/** Tool names differ by client: Claude Code has Bash, OpenCode has bash. */
function toolCall(step: Step, tools: { name: string }[]) {
  if (step.tool) return step.tool;
  if (step.shell === undefined) return undefined;
  const name = tools.find((t) => t.name === "Bash") ? "Bash" : "bash";
  return { name, input: { command: step.shell, description: step.why ?? "Run a command", ...(step.timeout ? { timeout: step.timeout } : {}) } };
}

let seq = 0;
const id = (p: string) => `${p}_demo${Date.now().toString(36)}${(seq++).toString(36)}`;

async function reply(res: ServerResponse, req: { model: string; stream?: boolean; tools?: { name: string }[]; messages: Msg[]; max_tokens?: number }) {
  const tools = req.tools ?? [];
  let step: Step;
  if (!tools.length) {
    // Side calls (session titles, topic checks, quota pings): short and harmless.
    const p = textOf(req.messages.at(-1)?.content ?? "");
    step = { text: /json/i.test(JSON.stringify(req)) && /title/i.test(p) ? '{"isNewTopic": true, "title": "Demo"}' : "Demo session" };
  } else {
    const pos = position(req.messages);
    step = pick(pos.prompt, pos.turn, pos.lastResult, pos.history, pos.all);
    log(`turn ${pos.turn} for "${pos.prompt.replace(/\s+/g, " ").slice(-80)}" -> ${step.shell ?? step.tool?.name ?? "text"}`);
  }
  const call = toolCall(step, tools);
  const content: Block[] = [];
  if (step.text) content.push({ type: "text", text: step.text });
  if (call) content.push({ type: "tool_use", id: id("toolu"), name: call.name, input: call.input });
  const stop = call ? "tool_use" : "end_turn";
  const usage = { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const message = { id: id("msg"), type: "message", role: "assistant", model: req.model, content, stop_reason: stop, stop_sequence: null, usage };

  if (!req.stream) {
    await sleep(step.delay ?? 400);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } });
  await sleep(tools.length ? step.delay ?? 900 : 50);
  let index = 0;
  if (step.text) {
    send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
    // Stream in word-sized pieces at a readable pace.
    const parts = step.text.match(/\S+\s*|\s+/g) ?? [];
    for (let i = 0; i < parts.length; i += 3) {
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: parts.slice(i, i + 3).join("") } });
      await sleep(tools.length ? 45 : 0);
    }
    send("content_block_stop", { type: "content_block_stop", index });
    index++;
  }
  if (call) {
    send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: content.at(-1)!.id, name: call.name, input: {} } });
    send("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) } });
    send("content_block_stop", { type: "content_block_stop", index });
  }
  send("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 80 } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

async function forward(req: IncomingMessage, res: ServerResponse, raw: string) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !["host", "content-length", "connection"].includes(k)) headers[k] = v;
  const r = await fetch(`https://api.anthropic.com${req.url}`, { method: req.method, headers, body: raw || undefined });
  res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !["content-encoding", "content-length", "transfer-encoding"].includes(k))));
  if (r.body) for await (const chunk of r.body) res.write(chunk);
  res.end();
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const raw = await body(req);
  const path = (req.url ?? "/").split("?")[0]!;
  try {
    if (path.startsWith("/mcp") || path.startsWith("/v1/mcp")) return await mcp(req, res, raw);
    if (REAL && path.startsWith("/v1/")) return await forward(req, res, raw);
    if (path === "/v1/messages/count_tokens") return void res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":1200}');
    if (path === "/v1/messages" && req.method === "POST") return await reply(res, JSON.parse(raw));
    if (path === "/health") return void res.writeHead(200).end("ok");
    log("unhandled", req.method, req.url);
    res.writeHead(404, { "content-type": "application/json" }).end('{"type":"error","error":{"type":"not_found_error","message":"not here"}}');
  } catch (e) {
    log("error", e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end('{"type":"error","error":{"type":"api_error","message":"demo model failed"}}');
  }
}

http(handle).listen(PORT, () => log(`demo model on :${PORT}${REAL ? " (forwarding to the real API)" : ""}`));
const cert = join(here, "certs");
if (existsSync(join(cert, "mcp.pem")))
  https({ key: readFileSync(join(cert, "mcp-key.pem")), cert: readFileSync(join(cert, "mcp.pem")) }, handle).listen(Number(process.env.TLS_PORT ?? 443), () => log("mcp over https"));
