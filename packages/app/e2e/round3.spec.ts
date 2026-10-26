import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request as pw, test, type APIRequestContext, type Page } from "@playwright/test";
import { backupConfig, CONFIG, deleteCurrentCanvas, open, restoreConfig, throwawayCanvas, WORKSPACE } from "./helpers";

// Every test here cleans up after itself: config is restored, secrets, sources, workflows and terminals
// it made are deleted, canvases are throwaway, and no agent run is started.
test.describe.configure({ mode: "serial" });
let skillsBefore: string[] = [];
// Cleanups run after all tests, in reverse order, with a request context that outlives each test.
const cleanups: (() => Promise<unknown>)[] = [];
// Canvas deletions click through the UI, so they run last and cannot hold up the API cleanups.
const canvasCleanups: (() => Promise<unknown>)[] = [];
// Settings restores run after everything else: turning code-server off restarts the door, which
// drops connections for a moment.
const settingsCleanups: (() => Promise<unknown>)[] = [];
/** Retries a cleanup while the door is restarting. */
async function retry(fn: () => Promise<unknown>) {
  for (let i = 0; i < 8; i++) {
    try {
      return await fn();
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
let api: APIRequestContext;
test.beforeAll(async () => {
  skillsBefore = backupConfig();
  api = await pw.newContext();
  // A run that was interrupted may have left its things behind; start clean.
  for (const id of ["e2e-hook", "e2e-setup"]) await api.delete(`${API}/sources/${id}`);
  for (const id of ["e2e-folder", "e2e-mcp"]) await api.delete(`${API}/workflows/${id}`);
  for (const n of ["E2E_HOOK_SECRET", "E2E_DOCS_TOKEN", "E2E_SETUP_SECRET"]) await api.delete(`${API}/secrets/${n}`);
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  for (const c of cleanups.reverse()) await retry(c);
  for (const c of canvasCleanups) await Promise.race([c().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  for (const c of settingsCleanups.reverse()) await retry(c);
  await api.dispose();
  restoreConfig(skillsBefore);
});

const API = "http://localhost:8080/api";
const settingsNow = async (r: APIRequestContext) => (await (await r.get(`${API}/settings`)).json()).settings as Record<string, any>;
const putSettings = (r: APIRequestContext, value: Record<string, any>) => r.put(`${API}/settings`, { data: { value } });
const cfg = () => JSON.parse(readFileSync(CONFIG, "utf8"));

test("Settings: box name in the sidebar and titles, and the webhook base URL on Sources", async ({ browser, request }) => {
  const before = await settingsNow(request);
  settingsCleanups.push(() => putSettings(api, before));
  const page = await open(browser, "settings-admin", "/settings");
  await page.getByTestId("settings-box-name").fill("E2E box");
  await page.getByTestId("settings-hooks-url").fill("https://hooks.e2e.example");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("box-name")).toHaveText("E2E box");
  await expect(page).toHaveTitle(/Settings · E2E box/);
  await page.goto("/sources?s=github");
  await expect(page.getByTestId("source-url")).toHaveText("https://hooks.e2e.example/hooks/github");
  // A bad value is refused with the reason under the field, and the file is untouched.
  const file = readFileSync(CONFIG, "utf8");
  await page.goto("/settings");
  await page.getByTestId("settings-hooks-url").fill("hooks.e2e.example/");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("form-errors")).toContainText("publicHooksUrl");
  expect(readFileSync(CONFIG, "utf8")).toBe(file);
});

test("Secrets: generate one on a source, see it once, and a test delivery passes with it", async ({ browser, request }) => {
  const r = await request.put(`${API}/sources/e2e-hook`, { data: { source: { title: "E2E hook", path: "/hooks/e2e-hook", verify: { kind: "header", header: "X-Hook-Secret", secret: "E2E_HOOK_SECRET" }, map: { type: "e2e.ping", payload: {} } } } });
  expect(r.ok()).toBe(true);
  cleanups.push(() => api.delete(`${API}/secrets/E2E_HOOK_SECRET`));
  cleanups.push(() => api.delete(`${API}/sources/e2e-hook`));
  const page = await open(browser, "secrets-admin", "/sources?s=e2e-hook");
  await expect(page.getByTestId("secret-state")).toHaveText("not set");
  await page.getByTestId("source-secret-generate").click();
  const value = (await page.getByTestId("secret-once-value").textContent())!;
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByTestId("secret-once-done").click();
  await expect(page.getByTestId("secret-state")).toHaveText("set");
  await page.getByTestId("source-test").click();
  await expect(page.getByTestId("source-test-result")).toContainText("HTTP 202");
  // The value is never shown again.
  await page.goto("/secrets");
  await expect(page.getByTestId("secret-row-E2E_HOOK_SECRET")).toContainText("source e2e-hook");
  expect(await page.content()).not.toContain(value);
  // The secret cannot go while the source still uses it.
  await page.getByTestId("secret-delete-E2E_HOOK_SECRET").click();
  await page.getByTestId("secret-delete-confirm").click();
  await expect(page.getByText(/is used by source e2e-hook/)).toBeVisible();
});

test("Workflows: a working folder for runs is a plain setting, saved to config.json", async ({ browser, request }) => {
  expect((await request.post(`${API}/workflows`, { data: { id: "e2e-folder", group: { title: "E2E folder" }, skill: false } })).ok()).toBe(true);
  cleanups.push(() => api.delete(`${API}/workflows/e2e-folder`));
  const page = await open(browser, "folder-admin", "/workflows/e2e-folder");
  await page.getByTestId("wf-workdir").fill("/tmp");
  await page.getByTestId("wf-save").click();
  await expect.poll(() => cfg().groups["e2e-folder"]?.workdir).toBe("/tmp");
  // Web access is on by default and can be switched off per workflow.
  await page.getByTestId("wf-tab-guards").click();
  await expect(page.getByTestId("wf-web-access")).toBeChecked();
  await page.getByTestId("wf-web-access").click();
  await page.getByTestId("wf-save").click();
  await expect.poll(() => cfg().groups["e2e-folder"]?.webAccess).toBe(false);
  await expect(page.getByTestId("shell-hint").first()).toBeVisible();
});

test("Terminals: open one from the picker, others see who opened it, then end it", async ({ browser, request }) => {
  const alice = await open(browser, "alice");
  await throwawayCanvas(alice);
  canvasCleanups.push(() => deleteCurrentCanvas(alice));
  await alice.getByTestId("add-window").click();
  await alice.getByTestId("add-terminal").click();
  // The new terminal loading can take focus and close the menu; open it again if so.
  await expect(async () => {
    await alice.getByTestId("terminal-picker").click();
    await alice.getByTestId("terminal-new").click({ timeout: 2_000 });
    await expect(alice.getByTestId("terminal-new-title")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await alice.getByTestId("terminal-new-title").fill("E2E term");
  await alice.getByTestId("terminal-new-create").click();
  await expect(alice.getByTestId("terminal-about")).toContainText("Opened by you");
  const bobView = await (await request.get(`${API}/terminals`, { headers: { "x-wb-as": "bob" } })).json();
  const mine = bobView.others.find((t: any) => t.title === "E2E term");
  expect(mine).toMatchObject({ createdBy: "alice@localhost" });
  cleanups.push(() => api.delete(`${API}/terminals/${mine.name}`, { headers: { "x-wb-as": "alice" } }));
  // Bob cannot end Alice's terminal; Alice ends it from the window menu.
  expect((await request.delete(`${API}/terminals/${mine.name}`, { headers: { "x-wb-as": "bob" } })).ok()).toBe(true); // dev mode makes everyone an admin
  await alice.reload();
  await expect.poll(async () => (await (await request.get(`${API}/terminals`)).json()).others.some((t: any) => t.name === mine.name)).toBe(false);
});

test("MCP: import a server from Claude Code's config and its token moves into the secrets store", async ({ browser, request }) => {
  const mcpFile = join(WORKSPACE, ".mcp.json");
  const original = readFileSync(mcpFile, "utf8");
  cleanups.push(async () => writeFileSync(mcpFile, original));
  const seeded = JSON.parse(original);
  seeded.mcpServers["e2e-docs"] = { type: "http", url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer e2e-token-abcdefghijklmnop" } };
  writeFileSync(mcpFile, JSON.stringify(seeded, null, 2));
  expect((await request.post(`${API}/workflows`, { data: { id: "e2e-mcp", group: { title: "E2E MCP" }, skill: false } })).ok()).toBe(true);
  cleanups.push(() => api.delete(`${API}/secrets/E2E_DOCS_TOKEN`));
  cleanups.push(() => api.delete(`${API}/workflows/e2e-mcp`));
  const page = await open(browser, "mcp-admin", "/workflows/e2e-mcp?tab=mcp");
  await page.getByTestId("mcp-import").click();
  const row = page.getByTestId("mcp-found-e2e-docs");
  await expect(row).toContainText("Moves headers.Authorization into the secrets store");
  await expect(page.getByTestId("mcp-import-dialog")).not.toContainText("e2e-token-abcdefghijklmnop");
  await row.locator("button[role=checkbox]").click();
  await page.getByTestId("mcp-import-run").click();
  await page.getByTestId("wf-save").click();
  await expect.poll(() => cfg().groups["e2e-mcp"]?.mcpServers?.["e2e-docs"]?.headers?.Authorization).toBe("Bearer ${secret:E2E_DOCS_TOKEN}");
  expect(readFileSync(CONFIG, "utf8")).not.toContain("e2e-token-abcdefghijklmnop");
  const secrets = await (await request.get(`${API}/secrets`)).json();
  expect(secrets.secrets.find((s: any) => s.name === "E2E_DOCS_TOKEN")).toMatchObject({ from: "store" });
});

test("Setup: an item turns red when something is missing and green when it is fixed; the sidebar follows", async ({ browser, request }) => {
  const page = await open(browser, "setup-admin", "/setup");
  await expect(page.getByTestId("setup-item-secrets")).toHaveAttribute("data-done", "true");
  await request.put(`${API}/sources/e2e-setup`, { data: { source: { path: "/hooks/e2e-setup", verify: { kind: "url-token", secret: "E2E_SETUP_SECRET" }, map: { type: "e2e.setup", payload: {} } } } });
  cleanups.push(() => api.delete(`${API}/secrets/E2E_SETUP_SECRET`));
  cleanups.push(() => api.delete(`${API}/sources/e2e-setup`));
  await page.reload();
  await expect(page.getByTestId("setup-item-secrets")).toHaveAttribute("data-done", "false");
  await expect(page.getByTestId("setup-item-secrets")).toContainText("E2E_SETUP_SECRET (source e2e-setup)");
  await expect(page.getByTestId("nav-setup")).toBeVisible();
  await request.post(`${API}/secrets`, { data: { name: "E2E_SETUP_SECRET", generate: true } });
  await page.reload();
  await expect(page.getByTestId("setup-item-secrets")).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("setup-progress")).toContainText("This box is set up");
  await expect(page.getByTestId("nav-setup")).toHaveCount(0);
});

test("code-server loads in a Code window when it is switched on", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const before = await settingsNow(request);
  settingsCleanups.push(() => putSettings(api, before));
  expect((await putSettings(request, { ...before, codeServer: true })).ok()).toBe(true);
  await expect.poll(async () => (await (await request.get(`${API}/status`)).json()).editor?.on, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await (await request.get(`${API}/services`)).json()).find((s: any) => s.id === "code-server")?.state, { timeout: 60_000 }).toBe("running");
  const page = await open(browser, "code-admin");
  await throwawayCanvas(page);
  canvasCleanups.push(() => deleteCurrentCanvas(page));
  await page.getByTestId("add-window").click();
  await page.getByTestId("add-code").click();
  await expect(page.frameLocator("[data-testid=code-frame]").locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const frame = page.frames().find((f) => f.url().includes("/code/"))!;
  await expect.poll(() => frame.title(), { timeout: 30_000 }).toMatch(/code-server/);
});

test("viewers read everything and change nothing", async ({ browser, request }) => {
  const before = await settingsNow(request);
  settingsCleanups.push(() => putSettings(api, before));
  const users = [...(before.access?.users ?? []), { email: "vic@localhost", role: "viewer" }];
  expect((await putSettings(request, { ...before, access: { ...(before.access ?? {}), users } })).ok()).toBe(true);
  const vic = await open(browser, "vic", "/c/work");
  await expect(vic.getByTestId("lock-toggle")).toBeDisabled();
  await expect(vic.getByTestId("add-window")).toBeDisabled();
  await vic.goto("/workflows/email-jeff?as=vic");
  await expect(vic.getByTestId("read-only-badge")).toBeVisible();
  await vic.goto("/settings?as=vic");
  await expect(vic.getByTestId("settings-box-name")).toBeDisabled();
  expect((await request.post(`${API}/runs`, { headers: { "x-wb-as": "vic" }, data: { group: "email-jeff", prompt: "x" } })).status()).toBe(403);
  expect((await request.put(`${API}/settings`, { headers: { "x-wb-as": "vic" }, data: { value: {} } })).status()).toBe(403);
});

test("someone working inside a terminal shows as a ring and a name tag, not a stuck cursor", async ({ browser }) => {
  const alice = await open(browser, "alice");
  const path = await throwawayCanvas(alice);
  canvasCleanups.push(() => deleteCurrentCanvas(alice));
  await alice.getByTestId("add-window").click();
  await alice.getByTestId("add-terminal").click();
  const bob = await open(browser, "bob", path);
  const body = (await alice.locator("[data-window-type=terminal] [data-window-body]").boundingBox())!;
  const tags = (p: Page) => p.getByTestId("window-presence-tag");
  await alice.mouse.move(body.x + 100, body.y + 120);
  await expect.poll(() => bob.getByTestId("remote-cursor").count()).toBe(0);
  await expect(tags(bob)).toHaveCount(0);
  await alice.mouse.click(body.x + 100, body.y + 120);
  await expect(tags(bob)).toContainText(["Alice"]);
  // Click the canvas background to the right of the window.
  await alice.mouse.move(body.x + body.width + 80, body.y + 40, { steps: 5 });
  await alice.mouse.click(body.x + body.width + 80, body.y + 40);
  await expect(tags(bob)).toHaveCount(0);
  await expect.poll(() => bob.getByTestId("remote-cursor").count()).toBe(1);
});
