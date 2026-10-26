import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { env, paths } from "./env.ts";
import { viewerFilter } from "./lib/yjs-roles.ts";

// y-websocket's server utils are CommonJS and require("yjs"); load Yjs the same way so there is one instance.
const require = createRequire(import.meta.url);
const Y = require("yjs") as typeof import("yjs");
const { setPersistence, setupWSConnection } = require("y-websocket/bin/utils") as {
  setPersistence: (p: unknown) => void;
  setupWSConnection: (conn: unknown, req: unknown, opts?: { docName?: string; gc?: boolean }) => void;
};
type Doc = import("yjs").Doc;

// Layouts and canvases live in Yjs; persist each doc to a file so a restart keeps them.
mkdirSync(paths.yjs, { recursive: true });
const fileFor = (name: string) => join(paths.yjs, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.bin`);
const timers = new Map<string, NodeJS.Timeout>();
const save = (name: string, doc: Doc) => {
  const f = fileFor(name);
  writeFileSync(`${f}.tmp`, Y.encodeStateAsUpdate(doc));
  renameSync(`${f}.tmp`, f);
};

setPersistence({
  provider: null,
  bindState: (name: string, doc: Doc) => {
    const f = fileFor(name);
    if (existsSync(f)) Y.applyUpdate(doc, readFileSync(f));
    doc.on("update", () => {
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => save(name, doc), 500));
    });
  },
  writeState: async (name: string, doc: Doc) => save(name, doc),
});

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("workbench yjs\n");
});
const wss = new WebSocketServer({ noServer: true });
/**
 * Viewers may watch canvases but not change them. The door's identity check sets X-Wb-Role on the
 * upgrade request; for a viewer, incoming sync step 2 and update messages (the ones that carry
 * changes) are dropped, while step 1 (asking for state) and awareness (cursor and presence) pass.
 * Connections without the header come from the app itself on loopback.
 */
wss.on("connection", (conn, req) => {
  // Caddy forwards /yjs/<room>; strip the prefix so the room name is just <room>.
  const room = (req.url ?? "/").replace(/^\/yjs/, "").replace(/^\//, "").split("?")[0] || "workbench";
  if (req.headers["x-wb-role"] === "viewer") {
    const on = conn.on.bind(conn);
    (conn as any).on = (event: string, fn: (...a: any[]) => void) =>
      on(event as any, event === "message" ? (data: Buffer, ...rest: unknown[]) => (viewerFilter(new Uint8Array(data)) ? fn(data, ...rest) : undefined) : fn);
  }
  setupWSConnection(conn, req, { docName: room });
});
server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)));
server.listen(env.yjsPort, "127.0.0.1", () => console.log(`yjs on 127.0.0.1:${env.yjsPort}, persisted in ${paths.yjs}`));
