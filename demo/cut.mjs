// Cuts clips again from their raw frames (after changing their segments) without
// recording them again.
//   node demo/cut.mjs light c4-workflow c7-mcp
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Camera } from "./rig/camera.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Kept in step with the segments each clip returns in rig/clips.mjs.
const CUTS = {
  "c4-workflow": [[["start", "asked", 3.5], ["asked", "answered", 1.4], ["answered", "end", 1.2]], "answer-read"],
  "c7-mcp": [[["start", "connected", 2.2], ["connected", "end", 1.4]], "poster"],
  "c10-opencode": [[["start", "logged-in", 1.8], ["logged-in", "open", 2], ["open", "answered", 1.3], ["answered", "end", 1]], "poster"],
};
const [theme, ...ids] = process.argv.slice(2);
const out = join(here, "out", theme);
const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
for (const id of ids) {
  const cam = Camera.load(join(here, "out", "raw", theme, id), report[id].marks);
  const [segments, poster] = CUTS[id];
  const { seconds } = cam.encode(out, `${id}-${theme}`, segments, poster);
  console.log(`${id} ${theme}: ${seconds.toFixed(1)}s`);
}
