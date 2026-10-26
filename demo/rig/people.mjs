// The people on the Acme box: one browser context each, signed in through the box's proxy mode,
// sharing one browser. Each moves its real mouse in small timed steps, so others see a smooth cursor.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { W, H, SCALE } from "./camera.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const { chromium } = createRequire(join(here, "../../packages/app/package.json"))("@playwright/test");
export const BOX = process.env.ACME_URL ?? "http://localhost:8090";
const SECRET = process.env.ACME_PROXY_SECRET ?? "acme-demo-proxy-secret";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real 1.25x screen, not an emulated one: headless WebGL draws terminal text at the wrong size
// under Playwright's emulated scale factor. Every context then uses the window's size (viewport null).
export const launch = () => chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${W},${H}`] });

// The camera's own pointer: a page only draws other people's cursors, so the recorded person gets one too.
const CURSOR = () => {
  if (window.top !== window) return;
  const make = () => {
    if (document.getElementById("demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L9.6 19z" fill="#0a0a0a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-80px,-80px)", willChange: "transform" });
    document.documentElement.appendChild(c);
  };
  document.readyState === "loading" ? addEventListener("DOMContentLoaded", make) : make();
  window.__demoCursor = (x, y, ms) => {
    make();
    const c = document.getElementById("demo-cursor");
    c.style.transition = `transform ${ms}ms cubic-bezier(.25,.8,.25,1)`;
    c.style.transform = `translate(${x - 5}px,${y - 3}px)`;
  };
  window.__demoPress = () => {
    const c = document.getElementById("demo-cursor");
    if (!c) return;
    c.animate([{ scale: "1" }, { scale: "0.82" }, { scale: "1" }], { duration: 220 });
  };
};

export class Person {
  constructor(name, page) {
    this.name = name;
    this.page = page;
    this.x = W / 2;
    this.y = H / 2;
  }

  static async open(browser, name, { theme, camera = false, path = "/" }) {
    const ctx = await browser.newContext({
      viewport: null,
      locale: "en-AU",
      timezoneId: "Australia/Sydney",
      extraHTTPHeaders: { "X-Forwarded-Email": `${name}@acme.dev`, "X-Workbench-Proxy-Secret": SECRET },
      reducedMotion: "no-preference",
    });
    await ctx.addCookies([{ name: "wb-theme", value: theme, url: BOX }]);
    if (camera) await ctx.addInitScript(CURSOR);
    const p = new Person(name, await ctx.newPage());
    p.camera = camera;
    await p.go(path);
    return p;
  }

  async go(path) {
    await this.page.goto(`${BOX}${path}`);
    await this.page.getByTestId("sidebar").waitFor();
    await this.page.waitForTimeout(800);
    const dismiss = this.page.getByTestId("cold-start-banner").getByRole("button", { name: "Dismiss" });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }

  /** Moves the mouse to (x, y) over ms, in steps others can follow. */
  async glide(x, y, ms = 700) {
    if (this.camera) await this.page.evaluate(([a, b, t]) => window.__demoCursor?.(a, b, t), [x, y, ms]);
    // Timed, not counted: under load a move can take a while, and the glide must still take ms.
    const [x0, y0] = [this.x, this.y];
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      if (k >= 1) break;
      await sleep(30);
    }
    this.x = x;
    this.y = y;
  }

  async box(locator) {
    await locator.waitFor({ state: "visible", timeout: 30000 });
    return locator.boundingBox();
  }

  /** Glides to the middle of a locator (or a point inside it) and clicks. */
  async click(locator, { ms = 700, dx = 0.5, dy = 0.5, pause = 250, double = false } = {}) {
    const b = await this.box(locator);
    await this.glide(b.x + b.width * dx, b.y + b.height * dy, ms);
    await sleep(pause);
    if (this.camera) await this.page.evaluate(() => window.__demoPress?.());
    await this.page.mouse.click(this.x, this.y, { clickCount: double ? 2 : 1 });
  }

  async hover(locator, ms = 700) {
    const b = await this.box(locator);
    await this.glide(b.x + b.width / 2, b.y + b.height / 2, ms);
  }

  async type(text, { delay = 55, enter = true } = {}) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(delay * (0.6 + Math.random() * 0.8));
    }
    if (enter) {
      await sleep(250);
      await this.page.keyboard.press("Enter");
    }
  }

  window(id) {
    return this.page.locator(`[data-window-id="${id}"]`);
  }

  /** The xterm inside a terminal window. */
  terminal(id) {
    return this.window(id).frameLocator("iframe").first().locator(".xterm-screen");
  }

  async close() {
    await this.page.context().close();
  }
}
