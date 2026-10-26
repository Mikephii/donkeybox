// Records the second round of footage (rig/scenes.mjs) from a fresh box per take.
//   node demo/record2.mjs light [workflow day]      both takes when none are named
// Clips (C4, C5 again; C12–C14) go to demo/out/<theme>/ like the first round. Every camera's frames stay in
// demo/out/raw/<theme>/<name>/ with its marks, for demo/compose.mjs to cut the long pieces from.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { takes } from "./rig/scenes.mjs";
import { forget } from "./rig/box.mjs";
import { launch, Person } from "./rig/people.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [theme = "light", ...only] = process.argv.slice(2);
const out = join(here, "out", theme);
mkdirSync(out, { recursive: true });
const reportFile = join(out, "report2.json");
const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : {};

for (const [name, take] of Object.entries(takes)) {
  if (only.length && !only.includes(name)) continue;
  process.stdout.write(`${name}: fresh box … `);
  execFileSync(join(here, "acme.sh"), ["reset", theme], { stdio: ["ignore", "ignore", "inherit"] });
  forget();
  console.log("up");
  const browser = await launch();
  const cast = { theme };
  // Everyone gets a drawn pointer: in the four-browser scene each of them is a camera.
  for (const n of ["alice", "sam", "kai", "jo"]) cast[n] = await Person.open(browser, n, { theme, camera: true, path: "/c/work" });
  const t = Date.now();
  try {
    const { clips, raws } = await take({ ...cast, raw: (id) => join(here, "out", "raw", theme, id) });
    for (const [id, { cam, segments, poster }] of Object.entries(clips)) {
      const { seconds } = cam.encode(out, `${id}-${theme}`, segments, poster);
      report[id] = { seconds: Math.round(seconds * 10) / 10, marks: cam.marks };
      console.log(`  ${id} ${report[id].seconds}s`);
    }
    for (const [id, cam] of Object.entries(raws)) {
      report[id] = { raw: true, seconds: Math.round(cam.marks.end * 10) / 10, marks: cam.marks };
      console.log(`  ${id} (raw) ${report[id].seconds}s`);
    }
    console.log(`  ${name} took ${Math.round((Date.now() - t) / 1000)}s`);
  } catch (e) {
    for (const n of ["alice", "sam", "kai", "jo"]) await cast[n].page.screenshot({ path: join(out, `fail2-${name}-${n}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    await browser.close();
  }
}
