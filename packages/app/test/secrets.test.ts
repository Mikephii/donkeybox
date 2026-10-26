import { createServer } from "node:http";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "../src/engine/config.ts";
import { buildRunSpec } from "../src/engine/runspec.ts";
import { FileSecretBackend, SecretStore, secretUses } from "../src/lib/secrets.ts";
import { GcpSecretBackend } from "../src/lib/gcp/secret-manager.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "wb-secrets-"));
const cfg = (extra: Record<string, unknown> = {}) =>
  configSchema.parse({
    sources: { gh: { path: "/hooks/gh", verify: { kind: "hmac", secret: "GH_SECRET" }, adapter: "github" } },
    groups: { g: { title: "G", mcpServers: { jira: { type: "http", url: "https://x.example", headers: { Authorization: "Bearer ${secret:JIRA_TOKEN}" } } } } },
    ...extra,
  });

describe("file secrets store", () => {
  it("generates 32 random bytes once, keeps the file at mode 600 and never lists values", async () => {
    const dir = tmp();
    const s = new SecretStore(new FileSecretBackend(join(dir, "secrets.json")), { env: {} });
    const r = await s.create("GH_SECRET");
    expect(r.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(r.value!, "base64url")).toHaveLength(32);
    expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
    const typed = await s.create("TYPED", "hunter2");
    expect(typed.value).toBeUndefined();
    const listed = JSON.stringify(s.list(cfg()));
    expect(listed).not.toContain(r.value);
    expect(listed).not.toContain("hunter2");
    expect(s.resolve("GH_SECRET")).toBe(r.value);
  });

  it("resolves the store first, then the environment", async () => {
    const s = new SecretStore(new FileSecretBackend(join(tmp(), "s.json")), { env: { A_SECRET: "from-env", B_SECRET: "env-b" } });
    await s.create("A_SECRET", "from-store");
    expect(s.resolve("A_SECRET")).toBe("from-store");
    expect(s.resolve("B_SECRET")).toBe("env-b");
    expect(s.resolve("C_SECRET")).toBeUndefined();
    expect(s.where("A_SECRET")).toBe("store");
    expect(s.where("B_SECRET")).toBe("env");
  });

  it("picks up a rotation written by another process on the next resolve", async () => {
    const path = join(tmp(), "s.json");
    const writer = new SecretStore(new FileSecretBackend(path), { env: {} });
    const reader = new SecretStore(new FileSecretBackend(path), { env: {} });
    await writer.create("HOOK", "one");
    await reader.load();
    expect(reader.resolve("HOOK")).toBe("one");
    await new Promise((r) => setTimeout(r, 20));
    await writer.rotate("HOOK", "two");
    expect(reader.resolve("HOOK")).toBe("two");
  });

  it("refuses bad names, duplicates, and deleting a secret config.json still uses", async () => {
    const s = new SecretStore(new FileSecretBackend(join(tmp(), "s.json")), { env: {} });
    for (const bad of ["lower", "1ABC", "A-B", "A B", "", "X".repeat(65)]) await expect(s.create(bad, "v")).rejects.toMatchObject({ status: 422 });
    await s.create("GH_SECRET", "v");
    await expect(s.create("GH_SECRET", "w")).rejects.toMatchObject({ status: 409 });
    await expect(s.delete("GH_SECRET", cfg())).rejects.toMatchObject({ status: 409, details: [{ where: "source gh" }] });
    await s.create("UNUSED", "v");
    await expect(s.delete("UNUSED", cfg())).resolves.toMatchObject({ deleted: true });
    expect(s.resolve("UNUSED")).toBeUndefined();
  });

  it("finds every reference: verifiers, MCP env and headers, repo tokens, sign-in and the scheduler", () => {
    const c = cfg({ settings: { scheduler: { mode: "external" }, auth: { oidc: { issuer: "https://id.example" } } } });
    expect([...secretUses(c, "dev").keys()]).not.toContain("PROXY_SECRET");
    expect([...secretUses(c, "proxy").keys()]).toContain("PROXY_SECRET");
    expect([...secretUses(c, "proxy").keys()]).not.toContain("OIDC_CLIENT_SECRET");
    const uses = secretUses(c);
    expect([...uses.keys()].sort()).toEqual(["GH_SECRET", "JIRA_TOKEN", "OIDC_CLIENT_SECRET", "PROXY_SECRET", "SCHEDULE_SECRET"]);
    expect(uses.get("JIRA_TOKEN")![0]).toMatchObject({ where: "workflow g (MCP jira)" });
  });

  it("lists names config.json needs that are missing or only in the environment", async () => {
    const s = new SecretStore(new FileSecretBackend(join(tmp(), "s.json")), { env: { SCHEDULE_SECRET: "x" } });
    await s.create("GH_SECRET", "v");
    const rows = Object.fromEntries(s.list(cfg()).map((r) => [r.name, r.from]));
    expect(rows).toMatchObject({ GH_SECRET: "store", PROXY_SECRET: null, JIRA_TOKEN: null });
  });
});

describe("runs get resolved MCP secrets but cannot read them back", () => {
  it("expands ${secret:NAME} into the run's MCP config (mode 600) and denies reading it and the store", async () => {
    const dir = tmp();
    const s = new SecretStore(new FileSecretBackend(join(dir, "secrets.json")), { env: {} });
    await s.create("JIRA_TOKEN", "tok-123");
    const group = cfg().groups.g!;
    const spec = buildRunSpec({ id: 7, prompt: "hi", group_id: "g", mode: "interactive", workdir: null, session_id: "00000000-0000-4000-8000-000000000007" } as any, "g", group, {
      runsDir: join(dir, "runs"), workDir: join(dir, "work"), skillsDir: join(dir, "skills"), hooksDir: "/h", mcpServer: "/m.ts", localApiUrl: "http://127.0.0.1:8001",
      claudeBin: "claude", extraPath: [], secretsFile: join(dir, "secrets.json"), expandSecrets: (v) => s.expand(v),
    }, false);
    const mcpFile = join(spec.dir, "mcp.json");
    expect(JSON.parse(readFileSync(mcpFile, "utf8")).mcpServers.jira.headers.Authorization).toBe("Bearer tok-123");
    expect(statSync(mcpFile).mode & 0o777).toBe(0o600);
    const deny = JSON.parse(readFileSync(join(spec.dir, "settings.json"), "utf8")).permissions.deny as string[];
    expect(deny).toContain(`Read(/${join(dir, "secrets.json")})`);
    expect(deny).toContain(`Read(/${mcpFile})`);
    expect(deny).toContain("Bash(*secrets.json*)");
  });
});

describe("Google Secret Manager backend", () => {
  it("creates, lists, reads, rotates and deletes through the REST API with a bearer token", async () => {
    const store = new Map<string, { createTime: string; labels: Record<string, string>; versions: string[] }>();
    const seen: string[] = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
        const u = new URL(req.url!, "http://x");
        const send = (code: number, j: unknown) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(j)));
        const m = u.pathname.match(/^\/v1\/projects\/p1\/secrets(?:\/([^/:]+))?(?:\/versions\/latest)?(?::(\w+))?$/);
        if (!m) return send(404, {});
        const [, id, verb] = m;
        if (req.method === "GET" && !id) return send(200, { secrets: [...store].filter(([, s]) => s.labels["managed-by"] === "workbench").map(([k, s]) => ({ name: `projects/p1/secrets/${k}`, createTime: s.createTime, labels: s.labels })) });
        if (req.method === "POST" && !id) {
          store.set(u.searchParams.get("secretId")!, { createTime: "2026-10-16T00:00:00Z", labels: JSON.parse(body).labels, versions: [] });
          return send(200, {});
        }
        const s = store.get(id!);
        if (!s) return send(404, {});
        if (verb === "addVersion") return (s.versions.push(JSON.parse(body).payload.data), send(200, {}));
        if (verb === "access") return send(200, { payload: { data: s.versions.at(-1) } });
        if (req.method === "PATCH") return ((s.labels = JSON.parse(body).labels), send(200, {}));
        if (req.method === "DELETE") return (store.delete(id!), send(200, {}));
        send(400, {});
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      const s = new SecretStore(new GcpSecretBackend({ project: "p1", endpoint: `http://127.0.0.1:${port}`, token: async () => "tok" }), { env: {} });
      const g = await s.create("HOOK_SECRET");
      expect(store.has("workbench-HOOK_SECRET")).toBe(true);
      expect(s.resolve("HOOK_SECRET")).toBe(g.value);
      await s.rotate("HOOK_SECRET", "second");
      expect(store.get("workbench-HOOK_SECRET")!.versions).toHaveLength(2);
      const fresh = new SecretStore(new GcpSecretBackend({ project: "p1", endpoint: `http://127.0.0.1:${port}`, token: async () => "tok" }), { env: {} });
      await fresh.load();
      expect(fresh.resolve("HOOK_SECRET")).toBe("second");
      await s.delete("HOOK_SECRET", cfg());
      expect(store.size).toBe(0);
      expect(seen.every((l) => l.endsWith("Bearer tok"))).toBe(true);
    } finally {
      srv.close();
    }
  });
});
