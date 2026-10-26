// Records the demo clips from the Acme box (demo/acme.sh up first).
//   node demo/record.mjs light [c1-estimate c2-approve ...]   all clips when none are named
// Writes demo/out/<theme>/<clip>.{mp4,webm,jpg}; raw frames go to demo/out/raw/.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clips, hero } from "./rig/clips.mjs";
import { writeVideo } from "./rig/camera.mjs";
import { launch, Person } from "./rig/people.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [theme = "light", ...only] = process.argv.slice(2);
const out = join(here, "out", theme);
mkdirSync(out, { recursive: true });

const browser = await launch();
const cast = { theme };
for (const name of ["alice", "sam", "kai", "jo"]) cast[name] = await Person.open(browser, name, { theme, camera: name === "alice", path: "/c/work" });

const report = {};
const cams = {};
try {
  for (const [id, run] of Object.entries(clips)) {
    if (only.length && !only.includes(id)) continue;
    const t = Date.now();
    process.stdout.write(`${id} … `);
    const { cam, segments, poster } = await run({ ...cast, raw: join(here, "out", "raw", theme, id) });
    cams[id] = cam;
    const { seconds } = cam.encode(out, `${id}-${theme}`, segments, poster);
    report[id] = { seconds: Math.round(seconds * 10) / 10, recordedIn: Math.round((Date.now() - t) / 1000), marks: cam.marks };
    console.log(`${report[id].seconds}s`);
  }
  if (hero.every(([id]) => cams[id])) {
    // The hero loop: the best of the first clips, a little faster.
    const list = hero.flatMap(([id, from, to]) => cams[id].frames30(from, to, 1.25));
    const { seconds } = writeVideo(out, `c11-hero-${theme}`, list, cams["c2-approve"].still("poster"), join(here, "out", "raw", theme));
    report["c11-hero"] = { seconds: Math.round(seconds * 10) / 10 };
    console.log(`c11-hero … ${report["c11-hero"].seconds}s`);
  }
} catch (e) {
  for (const name of ["alice", "sam", "kai", "jo"]) await cast[name].page.screenshot({ path: join(out, `fail-${name}.png`) }).catch(() => {});
  throw e;
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
