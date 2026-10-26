import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { backupConfig, LOCAL, open, restoreConfig, SKILLS } from "./helpers";

test.describe.configure({ mode: "serial" });
let skillsBefore: string[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
test.beforeAll(() => {
  skillsBefore = backupConfig();
});
test.afterAll(async () => {
  for (const c of cleanups) await c().catch(() => {});
  restoreConfig(skillsBefore);
});

test("sidebar navigation reaches every page, and the URL holds the filters", async ({ browser }) => {
  const page = await open(browser, "navigator");
  const pages: [string, RegExp, string][] = [
    ["inbox", /\/inbox/, "Inbox"],
    ["runs", /\/runs/, "Runs"],
    ["workflows", /\/workflows/, "Workflows"],
    ["sources", /\/sources/, "Sources"],
    ["services", /\/services/, "Services"],
    ["activity", /\/activity/, "Activity"],
    ["guide", /\/guide/, "Guide"],
    ["canvases", /\/c\//, ""],
  ];
  for (const [nav, url, heading] of pages) {
    await page.getByTestId(`nav-${nav}`).click();
    await expect(page).toHaveURL(url);
    if (heading) await expect(page.locator("h1").first()).toHaveText(heading);
  }
  await page.goto("/runs?status=done&group=housekeeping");
  await expect(page.getByTestId("filter-status")).toContainText("done");
  await expect(page.getByTestId("filter-group")).toContainText("Housekeeping");
  await page.getByTestId("runs-search").fill("deploy");
  await expect(page).toHaveURL(/q=deploy/);
  await page.goto("/guide");
  await page.getByTestId("guide").getByRole("link", { name: "Sources" }).first().click();
  await expect(page).toHaveURL(/\/sources/);
});

test("Inbox keyboard triage: j/k move, number keys act, forms take input", async ({ browser, request }) => {
  const id = `e2e-inbox-${Date.now().toString(36)}`;
  const created = await request.post(`/api/workflows`, {
    data: { id, group: { title: "E2E inbox", actions: [{ id: "approve", label: "Approve", style: "primary" }, { id: "changes", label: "Needs changes", input: { note: "text" } }, { id: "reject", label: "Reject", style: "danger" }] } },
  });
  expect(created.ok()).toBe(true);
  // Blocking requests with no run: answering them starts nothing.
  const ids: number[] = [];
  for (const t of ["first", "second", "third"]) {
    const r = await request.post(`${LOCAL}/requests`, { data: { group: id, title: `E2E ${t}`, body: `Request **${t}**`, mode: "blocking" } });
    ids.push((await r.json()).id);
  }
  // Whatever happens below, deleting the workflow closes its leftover requests.
  test.info().attach("workflow", { body: id });
  cleanups.push(() => request.delete(`/api/workflows/${id}`));
  const page = await open(browser, "triager", `/inbox?group=${id}`);
  const row = (rid: number) => page.getByTestId(`inbox-row-${rid}`);
  await expect(row(ids[2]!)).toHaveAttribute("data-selected", "true"); // newest first
  await page.keyboard.press("j");
  await expect(row(ids[1]!)).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("k");
  await expect(row(ids[2]!)).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("1"); // Approve the newest
  await expect(row(ids[2]!)).toHaveCount(0);
  await expect(row(ids[1]!)).toHaveAttribute("data-selected", "true"); // cursor moves on

  await page.keyboard.press("2"); // Needs changes opens a form
  await expect(page.getByTestId(`action-form-${ids[1]}`)).toBeVisible();
  await page.keyboard.type("shorter please");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`action-form-${ids[1]}`)).toHaveCount(0);
  await page.keyboard.press("2");
  await page.keyboard.type("shorter please");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect(row(ids[1]!)).toHaveCount(0);

  await page.keyboard.press("Enter"); // open the last one's page
  await expect(page).toHaveURL(new RegExp(`/requests/${ids[0]}$`));
  await expect(page.getByTestId(`request-page-${ids[0]}`)).toContainText("E2E first");

  const answered = await Promise.all(ids.slice(1).map(async (rid) => (await (await request.get(`/api/requests/${rid}`, { headers: { "x-wb-as": "x" } })).json()).answer));
  expect(answered[1]).toMatchObject({ action_id: "approve", actor: "triager@localhost" });
  expect(answered[0]).toMatchObject({ action_id: "changes", input: { note: "shorter please" } });

  await page.goto(`/inbox?group=${id}&tab=answered`);
  await expect(page.locator('[data-testid^="inbox-row-"]')).toHaveCount(2);
  const del = await (await request.delete(`/api/workflows/${id}`)).json();
  expect(del.closedRequests).toBe(1);
});

test("run page shows the timeline and live terminal side by side", async ({ browser, request }) => {
  const search = await (await request.get("/api/runs/search?size=20")).json();
  const run = search.rows.find((r: any) => r.mode === "interactive" && !r.session_deleted) ?? search.rows[0];
  test.skip(!run, "no runs yet");
  const page = await open(browser, "viewer", `/runs/${run.id}`);
  const detail = page.getByTestId(`run-page-${run.id}`);
  await expect(detail).toContainText(`#${run.id}`);
  await expect(detail.getByTestId("timeline")).toBeVisible();
  const detailRes = await (await request.get(`/api/runs/${run.id}`)).json();
  if (detailRes.alive) {
    const tl = (await detail.getByTestId("timeline").boundingBox())!;
    const term = (await detail.locator('iframe[data-terminal="1"]').boundingBox())!;
    expect(term.x).toBeGreaterThan(tl.x + tl.width - 5); // side by side
    expect(term.height).toBeGreaterThan(400);
    await expect(detail.getByTestId("steer-input")).toBeVisible();
  }
  await page.getByRole("link", { name: "Runs" }).first().click();
  await expect(page).toHaveURL(/\/runs$/);
});

test("create a workflow from the UI, edit it, then delete it", async ({ browser }) => {
  const page = await open(browser, "builder", "/workflows");
  const title = `E2E temp ${Date.now().toString(36)}`;
  await page.getByTestId("new-workflow").click();
  await page.getByTestId("wf-title").fill(title);
  const id = await page.getByTestId("wf-id").inputValue();
  await page.getByTestId("wf-description").fill("Created by the Playwright suite.");
  await page.getByTestId("wf-create").click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${id}$`));
  expect(existsSync(join(SKILLS, `${id}/SKILL.md`))).toBe(true);

  // Invalid edit shows the server's error next to the field and does not save.
  await page.getByTestId("wf-tab-actions").click();
  await page.getByTestId("wf-action-0-id").fill("Bad Id!");
  await page.getByTestId("wf-save").click();
  await expect(page.getByTestId("wf-actions").getByTestId("field-error").first()).toContainText("lowercase");
  await page.getByTestId("wf-action-0-id").fill("ship");
  await page.getByTestId("wf-action-0-label").fill("Ship it");
  await page.getByTestId("wf-save").click();
  await expect(page.getByTestId("wf-save")).toHaveText("Saved");

  // A rule, so deleting is refused until it is removed.
  await page.getByTestId("wf-tab-rules").click();
  await page.getByTestId("wf-add-rule").click();
  await page.getByTestId("wf-rule-0").getByPlaceholder("github.pull_request.merged").fill("e2e.never");
  await page.getByTestId("wf-save-rules").click();
  await expect(page.getByTestId("wf-save-rules")).toBeDisabled();
  await page.getByTestId("wf-tab-settings").click();
  await page.getByTestId("wf-delete").click();
  await expect(page.getByTestId("wf-settings").getByTestId("form-errors")).toContainText("rule");

  await page.getByTestId("wf-tab-rules").click();
  await page.getByTestId("wf-rule-0").getByRole("button", { name: "Remove rule" }).click();
  await page.getByTestId("wf-save-rules").click();
  await expect(page.getByTestId("wf-save-rules")).toBeDisabled();
  await page.getByTestId("wf-tab-settings").click();
  await page.getByTestId("wf-delete").click();
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.getByTestId(`workflow-card-${id}`)).toHaveCount(0);
  expect(existsSync(join(SKILLS, id))).toBe(false);
});

test("sources page: URL to paste and a signed test delivery", async ({ browser }) => {
  const page = await open(browser, "sourcer", "/sources?s=github");
  await expect(page.getByTestId("source-url")).toHaveText(/\/hooks\/github$/);
  await page.getByTestId("source-test").click();
  await expect(page.getByTestId("source-test-result")).toContainText("HTTP 202");
  await expect(page.getByTestId("source-deliveries")).toContainText("accepted");
});
