// Document windows: `wb open FILE.md` (the admin route behind it) puts a rendered markdown file on a
// canvas, and the window follows the file as it changes.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request as pw, test, type APIRequestContext } from "@playwright/test";
import { LOCAL, open, ROOT, WORKSPACE } from "./helpers";

const token = () => readFileSync(join(process.env.WB_DATA_DIR ?? join(ROOT, "data"), "admin.token"), "utf8").trim();
const file = join(WORKSPACE, "e2e-estimate.md");
let api: APIRequestContext;
let windowId: string | undefined;

test.beforeAll(async () => {
  api = await pw.newContext({ extraHTTPHeaders: { "x-wb-admin-token": token(), "x-wb-actor": "End-to-end tests <e2e@localhost>" } });
});
test.afterAll(async () => {
  if (windowId) await api.delete(`${LOCAL}/admin/windows/${windowId}`).catch(() => {});
  rmSync(file, { force: true });
});

test("a markdown file opens as a Document window, rendered, and follows the file", async ({ browser }) => {
  writeFileSync(file, "# DK-38: split into two\n\n| Ticket | Points |\n|---|---|\n| DK-46 | 2 |\n");
  const r = await api.post(`${LOCAL}/admin/docs/open`, { data: { path: file } });
  expect(r.status()).toBe(201);
  const win = await r.json();
  windowId = win.id;
  expect(win).toMatchObject({ type: "doc", title: "Document · e2e-estimate.md" });

  const page = await open(browser, "e2e@example.com", `/c/${win.canvasId}`);
  const doc = page.locator(`[data-window-id="${win.id}"]`).getByTestId("doc-window");
  await expect(doc.getByRole("heading", { name: "DK-38: split into two" })).toBeVisible();
  await expect(doc.getByRole("cell", { name: "DK-46" })).toBeVisible();

  // The window keeps up with the file.
  writeFileSync(file, "# DK-38: split into two\n\n| Ticket | Points |\n|---|---|\n| DK-46 | 2 |\n| DK-47 | 3 |\n");
  await expect(doc.getByRole("cell", { name: "DK-47" })).toBeVisible({ timeout: 6000 });

  // Opening it again brings back the same window; other files are refused.
  expect((await (await api.post(`${LOCAL}/admin/docs/open`, { data: { path: file } })).json()).id).toBe(win.id);
  expect((await api.post(`${LOCAL}/admin/docs/open`, { data: { path: join(WORKSPACE, "config.json") } })).status()).toBe(400);
  await page.context().close();
});
