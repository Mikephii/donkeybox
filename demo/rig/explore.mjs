// Pokes at the box by hand while writing clips: node demo/rig/explore.mjs <script.mjs>
// The script gets { alice, sam, kai, jo, shot(name) } and a few helpers.
import { join, resolve } from "node:path";
import { launch, Person, sleep } from "./people.mjs";
import * as box from "./box.mjs";

const S = process.env.SHOTS ?? "/tmp";
const browser = await launch();
const cast = {};
for (const name of ["alice", "sam", "kai", "jo"]) cast[name] = await Person.open(browser, name, { theme: process.env.THEME ?? "light", camera: true, path: "/c/work" });
const shot = (name, who = "alice") => cast[who].page.screenshot({ path: join(S, `${name}.png`) });
try {
  const { default: run } = await import(resolve(process.argv[2]));
  await run({ ...cast, shot, sleep, ...box });
} finally {
  await browser.close();
}
