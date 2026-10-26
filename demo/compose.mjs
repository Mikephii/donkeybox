// The compositor: cuts the long pieces (a day on the box, the hero loops) from recorded footage, with chat
// bubbles, a clock, zooms and drawings laid over it. A piece is data (compose/pieces.mjs); the stage
// (compose/stage.html) draws it at any time t; this steps t one frame at a time, screenshots each frame
// and encodes them like the clips (mp4, webm, poster).
//   node demo/compose.mjs light [m1-day h1-push ...]      every piece when none are named
//   node demo/compose.mjs light h4-zoom --still 0 4.5 9   stills at those seconds, into out/stills/
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Camera, writeVideo } from "./rig/camera.mjs";
import { chromium } from "./rig/people.mjs";
import { pieces } from "./compose/pieces.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const theme = args.shift() ?? "light";
const stillAt = args.includes("--still") ? args.splice(args.indexOf("--still")).slice(1).map(Number) : null;
const only = args;
const out = join(here, "out", theme);
const raw = join(here, "out", "raw", theme);
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
const report = { ...read(join(out, "report.json")), ...read(join(out, "report2.json")) };

const cams = {};
/** The footage helpers a piece is written with. */
const ctx = {
  theme,
  cam(name) {
    if (!cams[name]) {
      const dir = join(raw, name);
      // First-round recordings have no frames.json; their frame times come from the files and marks from report.json.
      if (!existsSync(dir) || (!existsSync(join(dir, "frames.json")) && !report[name]?.marks)) throw new Error(`no footage ${name} for ${theme}: record it first`);
      cams[name] = Camera.load(dir, report[name]?.marks);
    }
    return cams[name];
  },
  /** Seconds between two marks of a recording. */
  span(name, from, to) {
    const c = ctx.cam(name);
    return c.at(to) - c.at(from);
  },
  /** Frames (file URLs, one per 1/30 s) of a recording between two marks, at a speed. */
  seg(name, from, to, speed = 1) {
    return ctx.cam(name).frames30(from, to, speed).map((f) => pathToFileURL(f).href);
  },
  /** A recording's frame at a mark, held for some seconds. */
  hold(name, mark, seconds) {
    const f = pathToFileURL(ctx.cam(name).still(mark)).href;
    return Array.from({ length: Math.round(seconds * 30) }, () => f);
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const cdp = await page.context().newCDPSession(page);
try {
  for (const [id, make] of Object.entries(pieces)) {
    if (only.length && !only.includes(id)) continue;
    const spec = make(ctx);
    await page.goto(pathToFileURL(join(here, "compose", "stage.html")).href);
    await page.evaluate((s) => window.setup(s), { theme, layers: spec.layers });
    const shot = async (t, file) => {
      await page.evaluate((x) => window.render(x), t);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
      writeFileSync(file, Buffer.from(data, "base64"));
    };
    if (stillAt) {
      const dir = join(here, "out", "stills");
      mkdirSync(dir, { recursive: true });
      for (const t of stillAt) await shot(t, join(dir, `${id}-${theme}-${t}.jpg`));
      console.log(`${id}: ${stillAt.length} stills in out/stills (piece is ${spec.duration.toFixed(1)}s)`);
      continue;
    }
    const dir = join(raw, `_compose-${id}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const n = Math.round(spec.duration * 30);
    const list = [];
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const f = join(dir, `${String(i).padStart(6, "0")}.jpg`);
      await shot(i / 30, f);
      list.push(f);
      if (i % 300 === 0) process.stdout.write(`\r${id}: ${i}/${n}`);
    }
    const poster = list[Math.min(n - 1, Math.round((spec.poster ?? spec.duration / 2) * 30))];
    const { seconds } = writeVideo(out, `${id}-${theme}`, list, poster, dir);
    const r2 = read(join(out, "report2.json"));
    r2[id] = { composed: true, seconds: Math.round(seconds * 10) / 10 };
    writeFileSync(join(out, "report2.json"), JSON.stringify(r2, null, 2));
    console.log(`\r${id}: ${seconds.toFixed(1)}s in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
} finally {
  await browser.close();
}
