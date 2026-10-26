import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const Y = require("yjs") as typeof import("yjs");
const { WebsocketProvider } = require("y-websocket") as typeof import("y-websocket");

/** The real Yjs server process on a free port, as the door would reach it. */
let proc: ChildProcess;
const port = 20000 + Math.floor(Math.random() * 20000);
beforeAll(async () => {
  const data = mkdtempSync(join(tmpdir(), "wb-yjs-"));
  proc = spawn(process.execPath, [join(import.meta.dirname, "../src/yjs-server.ts")], { env: { ...process.env, WB_YJS_PORT: String(port), WB_DATA_DIR: data }, stdio: "pipe" });
  await new Promise<void>((r) => proc.stdout!.on("data", (d) => String(d).includes("yjs on") && r()));
});
afterAll(() => proc.kill());

function client(role?: string) {
  const doc = new Y.Doc();
  class RoleWS extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: role ? { "x-wb-role": role } : {} });
    }
  }
  const p = new WebsocketProvider(`ws://127.0.0.1:${port}/yjs`, "room1", doc, { WebSocketPolyfill: RoleWS as any, disableBc: true });
  return { doc, p, synced: new Promise<void>((r) => p.on("sync", (s: boolean) => s && r())) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("viewers on canvases", () => {
  it("a viewer receives everyone's changes but its own never reach anyone", async () => {
    const member = client("member");
    const viewer = client("viewer");
    await Promise.all([member.synced, viewer.synced]);
    member.doc.getMap("windows").set("w1", { x: 10 });
    await wait(300);
    expect(viewer.doc.getMap("windows").get("w1")).toEqual({ x: 10 });
    viewer.doc.getMap("windows").set("w1", { x: 999 });
    viewer.doc.getMap("windows").set("evil", { x: 1 });
    await wait(300);
    expect(member.doc.getMap("windows").get("w1")).toEqual({ x: 10 });
    expect(member.doc.getMap("windows").has("evil")).toBe(false);
    // A fresh client sees the server's copy, which never took the viewer's edits.
    const later = client();
    await later.synced;
    expect(later.doc.getMap("windows").toJSON()).toEqual({ w1: { x: 10 } });
    // Presence still flows from the viewer, so others see them watching.
    viewer.p.awareness.setLocalStateField("user", { email: "v@x", role: "viewer" });
    await wait(300);
    const seen = [...member.p.awareness.getStates().values()].map((s: any) => s.user?.email);
    expect(seen).toContain("v@x");
    for (const c of [member, viewer, later]) c.p.destroy();
  });
});
