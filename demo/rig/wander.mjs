// Other people's cursors, moving: whenever a clip shows the canvas, someone else is on it too. Each
// wanderer glides between points inside the given windows and pauses now and then, until stop() is
// awaited. The canvas is shared, so every camera on it sees them. A wanderer must not be asked to do
// anything else until it is stopped.
//
// Only points outside iframes: a terminal or the editor is an iframe, and a mouse over one moves inside
// that frame, so the canvas never hears of it and the others see the cursor stop. Title bars, toolbars,
// lists and the Inbox are fine.
import { sleep } from "./people.mjs";

export function wander(people, windows, { seed = 7 } = {}) {
  let on = true;
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = async (p) => {
    for (let tries = 0; tries < 12; tries++) {
      const id = windows[Math.floor(rand() * windows.length)];
      // "canvas" is anywhere on the canvas, between and over its windows.
      const b = await p.box(id === "canvas" ? p.page.getByTestId("canvas") : p.window(id)).catch(() => null);
      if (!b) continue;
      const x = b.x + b.width * (0.12 + rand() * 0.76), y = b.y + b.height * (0.05 + rand() * 0.9);
      const tag = await p.page.evaluate(([a, c]) => document.elementFromPoint(a, c)?.tagName ?? "", [x, y]);
      if (tag !== "IFRAME") return [x, y];
    }
    // Every try landed on an iframe: the top of the first window, its title bar, always works.
    const b = await p.box(p.window(windows[0])).catch(() => null);
    return b ? [b.x + b.width * (0.2 + rand() * 0.6), b.y + 14] : null;
  };
  const loops = people.map(async (p, i) => {
    await sleep(i * 350);
    while (on) {
      try {
        const at = await pick(p);
        if (at) await p.glide(at[0], at[1], 1100 + rand() * 1100);
        await sleep(250 + rand() * 700);
      } catch {
        return; // the page went away (the scene failed or moved on); the scene reports its own error
      }
    }
  });
  return { stop: async () => ((on = false), await Promise.all(loops)) };
}
