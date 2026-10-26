// Records a page as a sharp video: Chrome's screencast frames (JPEG, every change), with timestamps,
// then re-timed to 30 fps by ffmpeg. Marks name moments so a clip can be trimmed and sped up later.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The page is 1280x800 at 1.25x, so frames are 1600x1000 with everything a quarter larger.
export const W = 1280;
export const H = 800;
export const SCALE = 1.25;
const FPS = 30;

export class Camera {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = [];
    this.marks = {};
  }

  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.t0 = Date.now() / 1000;
    this.cdp.on("Page.screencastFrame", (f) => {
      const file = join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ t: f.metadata.timestamp - this.t0, file });
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
    this.mark("start");
  }

  mark(name) {
    this.marks[name] = Date.now() / 1000 - this.t0;
    return this.marks[name];
  }

  async stop() {
    this.mark("end");
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await this.cdp.detach().catch(() => {});
    // Kept so demo/cut.mjs can cut the clip again without recording it again.
    writeFileSync(join(this.dir, "frames.json"), JSON.stringify({ frames: this.frames, marks: this.marks }));
  }

  /** A camera from a recording on disk (frames.json, or the frames' file times when it is missing). */
  static load(dir, marks) {
    const cam = new Camera(null, dir);
    const saved = join(dir, "frames.json");
    if (existsSync(saved)) Object.assign(cam, JSON.parse(readFileSync(saved, "utf8")));
    else {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
      const t0 = statSync(join(dir, files[0])).mtimeMs;
      cam.frames = files.map((f) => ({ t: (statSync(join(dir, f)).mtimeMs - t0) / 1000, file: join(dir, f) }));
      cam.marks = marks;
    }
    return cam;
  }

  /** The source time (seconds) of a mark, or a number as is. */
  at(m) {
    return typeof m === "number" ? m : this.marks[m];
  }

  /** The frames to show for [from, to] at a speed, one per output frame. */
  frames30(from, to, speed = 1) {
    const out = [];
    const frameAt = (t) => {
      let best = this.frames[0];
      for (const f of this.frames) if (f.t <= t) best = f;
      return best.file;
    };
    for (let t = this.at(from); t < this.at(to); t += speed / FPS) out.push(frameAt(t));
    return out;
  }

  still(mark) {
    let best = this.frames[0];
    for (const f of this.frames) if (f.t <= this.at(mark) - 0.05) best = f;
    return best.file;
  }

  /**
   * Writes NAME.mp4, NAME.webm and NAME.jpg (the poster) into outDir. segments are kept in order,
   * each [from, to, speed]; from/to are mark names or seconds.
   */
  encode(outDir, name, segments, poster) {
    const list = segments.flatMap(([a, b, speed]) => this.frames30(a, b, speed));
    return writeVideo(outDir, name, list, this.still(poster ?? segments.at(-1)[1]), this.dir);
  }
}

/** Encodes a list of frames (one per 1/30 s) as mp4 and webm, plus a poster. */
export function writeVideo(outDir, name, list, poster, scratch) {
  const txt = join(scratch, `${name}.txt`);
  writeFileSync(txt, list.map((f) => `file '${f}'\nduration ${1 / FPS}`).join("\n") + `\nfile '${list.at(-1)}'\n`);
  mkdirSync(outDir, { recursive: true });
  const base = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", txt, "-vf", `fps=${FPS},format=yuv420p`];
  execFileSync("ffmpeg", [...base, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-tune", "stillimage", "-movflags", "+faststart", "-an", join(outDir, `${name}.mp4`)]);
  execFileSync("ffmpeg", [...base, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an", join(outDir, `${name}.webm`)]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", poster, "-q:v", "3", join(outDir, `${name}.jpg`)]);
  return { seconds: list.length / FPS };
}
