import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request as pw, test, type APIRequestContext } from "@playwright/test";
import { LOCAL, open, ROOT } from "./helpers";

// Draining for an update shows a banner to everyone and holds the queue; the test always undrains.
const token = () => readFileSync(join(process.env.WB_DATA_DIR ?? join(ROOT, "data"), "admin.token"), "utf8").trim();
let api: APIRequestContext;
test.beforeAll(async () => {
  api = await pw.newContext({ extraHTTPHeaders: { "x-wb-admin-token": token(), "x-wb-actor": "End-to-end tests <e2e@localhost>" } });
  await api.post(`${LOCAL}/admin/undrain`, { data: {} });
});
test.afterAll(async () => {
  await api.post(`${LOCAL}/admin/undrain`, { data: {} });
  await api.dispose();
});

test("draining for an update shows a banner on every page until the drain ends", async ({ browser }) => {
  const alice = await open(browser, "alice", "/runs");
  const bob = await open(browser, "bob", "/c/work");
  await expect(alice.getByTestId("drain-banner")).toHaveCount(0);

  const r = await api.post(`${LOCAL}/admin/drain`, { data: { timeoutSeconds: 60 } });
  expect(r.ok()).toBe(true);
  expect(await r.json()).toMatchObject({ draining: true, by: "e2e@localhost" });

  // Both people see it without reloading.
  await expect(alice.getByTestId("drain-banner")).toContainText("getting ready for an update (e2e@localhost)");
  await expect(alice.getByTestId("drain-banner")).toContainText("New runs wait in the queue");
  await expect(bob.getByTestId("drain-banner")).toBeVisible();
  // The Runs page says why queued runs are not starting.
  await expect(alice.getByTestId("limits-bar")).toContainText("Waiting: the box is getting ready for an update");

  expect((await (await api.post(`${LOCAL}/admin/undrain`, { data: {} })).json()).draining).toBe(false);
  await expect(alice.getByTestId("drain-banner")).toHaveCount(0);
  await expect(bob.getByTestId("drain-banner")).toHaveCount(0);
  await expect(alice.getByTestId("limits-bar")).not.toContainText("getting ready");
  await alice.context().close();
  await bob.context().close();
});
