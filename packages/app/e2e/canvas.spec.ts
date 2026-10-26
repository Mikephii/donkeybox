import { expect, test, type Page } from "@playwright/test";
import { deleteCurrentCanvas, layerTransform, open, parseTransform, throwawayCanvas } from "./helpers";

test.describe.configure({ mode: "serial" });
const windowCount = (p: Page) => p.locator("[data-window-id]").count();

test("canvas is shared: windows, layout, canvases and cursors sync between two people", async ({ browser }) => {
  const alice = await open(browser, "alice");
  const bob = await open(browser, "bob");
  const tabs = (p: Page) => p.getByTestId("canvas-tabs").locator(".group").count();
  const tabsBefore = await tabs(bob);
  const canvasPath = await throwawayCanvas(alice);
  await expect.poll(() => tabs(bob)).toBe(tabsBefore + 1);
  await bob.goto(canvasPath);

  // Alice adds a window; Bob sees it.
  await alice.getByTestId("add-window").click();
  await alice.getByTestId("add-activity").click();
  await expect.poll(() => windowCount(bob)).toBe(1);
  const id = (await alice.locator("[data-window-type=activity]").getAttribute("data-window-id"))!;
  const aliceWin = alice.locator(`[data-window-id="${id}"]`);
  const bobWin = bob.locator(`[data-window-id="${id}"]`);

  // Drag by the title bar; Bob sees the move.
  const start = (await bobWin.boundingBox())!;
  const handle = (await aliceWin.locator("header").boundingBox())!;
  await alice.mouse.move(handle.x + 60, handle.y + handle.height / 2);
  await alice.mouse.down();
  await alice.mouse.move(handle.x + 260, handle.y + 140, { steps: 12 });
  await alice.mouse.up();
  await expect.poll(async () => Math.round((await bobWin.boundingBox())!.x - start.x)).toBeGreaterThan(150);

  // Resize from the corner; Bob sees the new size.
  const box = (await aliceWin.boundingBox())!;
  const w0 = (await bobWin.boundingBox())!.width;
  await alice.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await alice.mouse.down();
  await alice.mouse.move(box.x + box.width + 120, box.y + box.height + 60, { steps: 10 });
  await alice.mouse.up();
  await expect.poll(async () => Math.round((await bobWin.boundingBox())!.width - w0)).toBeGreaterThan(80);

  // Bob sees Alice's named cursor.
  // Cursor updates are throttled; keep moving until Bob has seen one.
  await expect(async () => {
    await alice.mouse.move(300 + Math.random() * 40, 760, { steps: 3 });
    await expect(bob.getByTestId("remote-cursor").filter({ hasText: "Alice" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  // Name and description, visible to Bob with an info tooltip.
  await aliceWin.getByRole("button", { name: "Window options" }).click();
  await alice.getByTestId("window-edit").click();
  await alice.getByTestId("window-name").fill("Team activity");
  await alice.getByTestId("window-description").fill("Everything that happened today.");
  await alice.getByTestId("window-save").click();
  await expect(bobWin.locator("header")).toContainText("Team activity");
  await bobWin.getByTestId("window-info").hover();
  await expect(bob.getByRole("tooltip")).toContainText("Everything that happened today.");

  // Stored positions sit on the 20px grid.
  const spec = await bob.evaluate((wid) => {
    const el = document.querySelector(`[data-window-id="${wid}"]`)!.parentElement!;
    const m = el.style.transform.match(/translate\((-?\d+)px, (-?\d+)px\)/);
    return m ? [Number(m[1]) % 20, Number(m[2]) % 20, el.offsetWidth % 20, el.offsetHeight % 20] : null;
  }, id);
  expect(spec).toEqual([0, 0, 0, 0]);

  // Close, Undo from the toast, close again, restore from Recently closed.
  await aliceWin.getByRole("button", { name: "Window options" }).click();
  await alice.getByTestId("window-close").click();
  await expect.poll(() => windowCount(bob)).toBe(0);
  await alice.locator("[data-sonner-toast]").filter({ hasText: "Closed Team activity" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => windowCount(bob)).toBe(1);
  await aliceWin.getByRole("button", { name: "Window options" }).click();
  await alice.getByTestId("window-close").click();
  await alice.getByTestId("add-window").click();
  await alice.getByTestId(`restore-${id}`).click();
  await expect.poll(() => windowCount(bob)).toBe(1);

  await deleteCurrentCanvas(alice);
  await expect.poll(() => tabs(bob)).toBe(tabsBefore);
});

test("pan with Space-drag and scroll, zoom with the controls and Cmd/Ctrl+scroll", async ({ browser }) => {
  const page = await open(browser, "panner");
  await throwawayCanvas(page);
  await page.getByTestId("add-window").click();
  await page.getByTestId("add-preview").click();
  const canvas = page.getByTestId("canvas");
  const box = (await canvas.boundingBox())!;
  expect(await canvas.evaluate((el) => getComputedStyle(el).overflow)).toBe("hidden");

  // Space + drag pans.
  const t0 = parseTransform(await layerTransform(page));
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 120);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 260, box.y + box.height - 220, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const t1 = parseTransform(await layerTransform(page));
  expect(Math.round(t1.x - t0.x)).toBe(-200);
  expect(Math.round(t1.y - t0.y)).toBe(-100);

  // Scrolling over the background pans; it never scrolls the page.
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 60);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => parseTransform(await layerTransform(page)).y).toBeLessThan(t1.y - 100);

  // Zoom buttons, Cmd/Ctrl+scroll, reset and fit.
  await page.getByTestId("zoom-in").click();
  await expect(page.getByTestId("zoom-level")).toHaveText("120%");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(async () => parseTransform(await layerTransform(page)).z).toBeGreaterThan(1.2);
  await page.getByTestId("zoom-level").click();
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
  await page.getByTestId("zoom-fit").click();
  const win = (await page.locator("[data-window-id]").boundingBox())!;
  expect(win.x).toBeGreaterThanOrEqual(box.x);
  expect(win.x + win.width).toBeLessThanOrEqual(box.x + box.width + 1);

  // Windows still drag correctly while zoomed, and land on the grid.
  await page.getByTestId("zoom-out").click();
  const header = (await page.locator("[data-window-id] header").boundingBox())!;
  await page.mouse.move(header.x + 40, header.y + 8);
  await page.mouse.down();
  await page.mouse.move(header.x + 140, header.y + 58, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const pos = await page.locator("[data-window-id]").evaluate((el) => (el.parentElement as HTMLElement).style.transform);
      const m = pos.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!;
      return [Number(m[1]) % 20, Number(m[2]) % 20];
    })
    .toEqual([0, 0]);

  await deleteCurrentCanvas(page);
});

test("edit lock: shared, blocks layout changes, keeps windows usable", async ({ browser }) => {
  const alice = await open(browser, "alice");
  const bob = await open(browser, "bob");
  const path = await throwawayCanvas(alice);
  await bob.goto(path);
  await alice.getByTestId("add-window").click();
  await alice.getByTestId("add-preview").click();

  // New canvases start unlocked by their creator; Bob sees who unlocked it.
  await expect(bob.getByTestId("lock-toggle")).toContainText("Alice");

  await alice.getByTestId("lock-toggle").click();
  await expect(bob.getByTestId("lock-toggle")).toHaveAttribute("data-locked", "true");
  await expect(alice.getByTestId("add-window")).toBeDisabled();
  await expect(alice.getByTestId("arrange")).toBeDisabled();

  const win = alice.locator("[data-window-id]");
  const before = (await win.boundingBox())!;
  const header = (await win.locator("header").boundingBox())!;
  await alice.mouse.move(header.x + 60, header.y + 8);
  await alice.mouse.down();
  await alice.mouse.move(header.x + 260, header.y + 160, { steps: 8 });
  await alice.mouse.up();
  expect((await win.boundingBox())!.x).toBe(before.x);
  await win.getByRole("button", { name: "Window options" }).click();
  await expect(alice.getByTestId("window-close")).toHaveAttribute("data-disabled", "");
  await alice.keyboard.press("Escape");

  // Windows still work while locked: change the preview's port.
  await win.getByLabel("Port").fill("3334");
  await win.getByLabel("Port").press("Enter");
  await expect(bob.locator("[data-window-id] header")).toContainText(":3334");

  // Bob unlocks; Alice sees it was Bob.
  await bob.getByTestId("lock-toggle").click();
  await expect(alice.getByTestId("lock-toggle")).toContainText("Bob");
  await expect(alice.getByTestId("add-window")).toBeEnabled();
  await deleteCurrentCanvas(alice);
});

test("theme is a cookie and reaches the terminal", async ({ browser }) => {
  const page = await open(browser, "carol", "/c/work", "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  // A terminal loading on the canvas can take focus and close the menu; open it again if so.
  await expect(async () => {
    await page.getByTestId("theme-toggle").click();
    await page.getByTestId("theme-dark").click({ timeout: 2_000 });
    await expect(page.locator("html")).toHaveClass(/dark/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  expect((await page.context().cookies()).find((c) => c.name === "wb-theme")?.value).toBe("dark");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /theme/i.test(k)))).toEqual([]);
  await expect.poll(() => page.evaluate(() => (document.querySelector('iframe[data-terminal="1"]') as any)?.contentWindow?.term?.options?.theme?.background), { timeout: 20_000 }).toBe("#1a1a18"); // the dark card, tokens.css
});
