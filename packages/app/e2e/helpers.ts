import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Page } from "@playwright/test";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WORKSPACE = process.env.WB_WORKSPACE_DIR ?? join(ROOT, "workspace");
export const CONFIG = join(WORKSPACE, "config.json");
export const SKILLS = join(WORKSPACE, ".claude/skills");
const BACKUP = join(process.env.WB_DATA_DIR ?? join(ROOT, "data"), "config.e2e-backup.json");
export const LOCAL = "http://127.0.0.1:8001";

/** Tests change config through the UI; this puts the workspace's config.json and skills back exactly. */
export function backupConfig() {
  copyFileSync(CONFIG, BACKUP);
  return readdirSync(SKILLS);
}
export function restoreConfig(skillsBefore: string[]) {
  if (existsSync(BACKUP)) copyFileSync(BACKUP, CONFIG);
  for (const s of readdirSync(SKILLS)) if (!skillsBefore.includes(s)) rmSync(join(SKILLS, s), { recursive: true });
  // The app committed each test edit to the box's config repo; record the restore too so it is left clean.
  const git = (...a: string[]) => execFileSync("git", ["-C", WORKSPACE, ...a], { encoding: "utf8" });
  if (git("status", "--porcelain").trim()) {
    git("add", "-A");
    git("-c", "user.name=Workbench", "-c", "user.email=workbench@localhost", "commit", "-q", "--author", "End-to-end tests <e2e@localhost>", "-m", "Restore after end-to-end tests");
  }
}

export async function open(browser: Browser, as: string, path = "/c/work", theme?: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (theme) await ctx.addCookies([{ name: "wb-theme", value: theme, url: "http://localhost:8080" }]);
  const page = await ctx.newPage();
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}as=${as}`);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  return page;
}

/** Creates a throwaway canvas (unlocked by its creator) and returns its path. */
export async function throwawayCanvas(page: Page): Promise<string> {
  await page.goto("/c/work");
  await page.getByRole("button", { name: "New canvas" }).click();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+$/);
  return new URL(page.url()).pathname;
}

export async function deleteCurrentCanvas(page: Page) {
  const id = new URL(page.url()).pathname.split("/").pop();
  if ((await page.getByTestId("lock-toggle").getAttribute("data-locked")) === "true") await page.getByTestId("lock-toggle").click();
  const tab = page.getByTestId("canvas-tabs").locator(".group").filter({ has: page.locator(`button`) }).last();
  await tab.hover();
  await tab.getByRole("button", { name: /options$/ }).click();
  await page.getByRole("menuitem", { name: /Delete canvas/ }).click();
  await expect(page).not.toHaveURL(new RegExp(`/c/${id}$`));
}

export const layerTransform = (page: Page) => page.getByTestId("canvas-layer").evaluate((el) => (el as HTMLElement).style.transform);
export const parseTransform = (t: string) => {
  const m = t.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/)!;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
};
