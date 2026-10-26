// The long pieces, as data for the stage (compose/stage.js). Times are seconds on the piece's own clock.
// Footage comes from the recordings by name and mark (ctx.seg); crops are in the recording's pixels
// (1600x1000: the box at 1280x800, 1.25x). A canvas window at (x, y) of width w is at win(x, y, w).
//
// m1-day   A day on the box (docs/landing-selling-points.md, M1): chat bubbles say who asked for what,
//          a clock and a list of the day's beats down the left, real footage on the right.
// h1-push  Ship your product, the box runs the chores: a push from a laptop lands on the box, then runs on a merge.
// h2-lids  It keeps working when you've gone home: people leave, the night's work happens, Kai answers.
// h3-same  One box, everyone's screen: the same canvas in four browsers at once.
// h4-zoom  A Linux box your agents can live in: from one typed line out to the box and what feeds it.
// h5-typed Describe the chore: Alice asks Claude for a workflow and it is running a minute later.
// h0-home  The home page's hero: h4 then h1.

const S = 1.25;
const win = (x, y, w, pad = 14) => ({ x: S * (68 + x) - pad, y: S * (44 + y) - pad, w: S * w + 2 * pad });
const FULL = { x: 0, y: 0, w: 1600 };
const CANVAS = { x: 96, y: 62, w: 1490 };
const C = { alice: "#a74900", sam: "#007a70", kai: "#6055c4", jo: "#a53f69", github: "#24292f", jira: "#1868db", clock: "#5b6472", run: "#8a5a00" };
const T = (h, m) => h * 60 + m;

/** Appends footage beats one after another; each beat's frames start after a short hold of its first frame.
 *  b.at(mark) is where a mark of the beat's footage falls, in seconds from the beat's start. */
function sequence(ctx, beats, { gap = 0.35 } = {}) {
  let t = 0;
  return beats.map((b) => {
    const frames = b.parts.flatMap(([name, from, to, speed]) => ctx.seg(name, from, to, speed));
    const lead = b.lead ?? 1;
    const all = [...Array(Math.round(lead * 30)).fill(frames[0]), ...frames, ...Array(Math.round((b.tail ?? 0.6) * 30)).fill(frames.at(-1))];
    const at = (mark) => {
      let x = lead;
      for (const [name, from, to, speed] of b.parts) {
        const c = ctx.cam(name), m = c.at(mark);
        if (m !== undefined && m >= c.at(from) && m <= c.at(to)) return x + (m - c.at(from)) / speed;
        x += (c.at(to) - c.at(from)) / speed;
      }
      return x;
    };
    const t0 = t;
    const t1 = t0 + all.length / 30;
    t = t1 - gap;
    return { ...b, t0, t1, frames: all, lead, at };
  });
}

const bubble = (who, color, html, t0, t1, x, y, extra = {}) => ({ kind: "bubble", who, color, html, t0, t1, x, y, rise: true, z: 5, ...extra });
const line = (html, t0, t1, x, y, size = 64, extra = {}) => ({ kind: "text", cls: "line", html, t0, t1, x, y, size, rise: true, z: 6, ...extra });

export const pieces = {
  "m1-day"(ctx) {
    const PANEL = { x: 452, y: 48, w: 1100, h: 688 };
    const BY = 768;
    const REQ = { x: 100, y: 70, w: 720 }, RUNS = { x: 100, y: 520, w: 720 }, ACT = { x: 820, y: 70, w: 760 }, PANE = { x: 1000, y: 470, w: 600 };
    const skillTake = (() => { try { return ctx.cam("f-skill") && "f-skill"; } catch { return "c3-skill"; } })();
    const beats = sequence(ctx, [
      {
        time: "02:00", m: T(2, 0), rail: "The schedule runs the nightly chores",
        say: [["Schedule", C.clock, "nightly housekeeping", { icon: "clock" }]],
        parts: [["c9-nightly", "start", "run", 1.3]],
        crop: (d, b) => [{ t: 0, ...FULL }, { t: b.at("run") - 2.4, ...FULL }, { t: b.at("run") - 1.2, x: 85, y: 0, w: 1000 }],
      },
      {
        time: "08:52", m: T(8, 52), rail: "A new ticket: estimated, split sent to the Inbox",
        say: [["Jira", C.jira, "DK-45 created: <b>Bulk price changes from a spreadsheet</b>", { icon: "jira" }]],
        parts: [["c12-card", "start", "card", 1.3], ["c12-card", "card", "poster", 1.2]],
        crop: (d, b) => [{ t: 0, ...CANVAS }, { t: b.at("ticket") + 0.2, ...CANVAS }, { t: b.at("ticket") + 0.9, ...ACT }, { t: b.at("run") + 1.9, ...ACT }, { t: b.at("run") + 2.6, ...RUNS }, { t: b.at("card") - 0.1, ...RUNS }, { t: b.at("card") + 0.6, ...REQ }],
      },
      {
        time: "09:05", m: T(9, 5), rail: "Alice runs the skill by hand; it just does it",
        say: [["Alice", C.alice, "<code>/ticket-estimate DK-38</code>"]],
        parts: [["c14-by-hand", "start", "doc", 1.3], ["c14-by-hand", "doc", "poster", 1.5]],
        crop: (d, b) => [{ t: 0, x: 112, y: 700, w: 480 }, { t: b.at("asked") - 0.1, x: 112, y: 700, w: 480 }, { t: b.at("asked") + 0.9, ...CANVAS }, { t: b.at("doc"), ...CANVAS }, { t: b.at("doc") + 1.1, x: 870, y: 70, w: 730 }],
      },
      {
        time: "09:10", m: T(9, 10), rail: "Kai approves; a new run makes the tickets",
        say: [["Kai", C.kai, "Looks right. <b>Approve.</b>"]],
        parts: [["c13-answer", "start", "approved", 1.3], ["c13-answer", "approved", "done", 1.6], ["c13-answer", "done", "poster", 1.3]],
        crop: (d, b) => [{ t: 0, ...REQ }, { t: b.at("approved") + 0.3, ...REQ }, { t: b.at("approved") + 1, ...RUNS }, { t: b.at("done") + 0.4, ...RUNS }, { t: b.at("done") + 1.3, ...PANE }],
      },
      {
        time: "09:14", m: T(9, 14), rail: "A PR merges; QA notes land on DK-43",
        say: [["GitHub", C.github, "acme/shop <b>#87 merged</b>: Add CSV export endpoint", { icon: "github" }]],
        parts: [["c5-merged", "start", "poster", 1.3]],
        crop: () => [{ t: 0, x: 85, y: 0, w: 1100 }],
      },
      {
        time: "09:40", m: T(9, 40), rail: "The team changes the skill, on the box",
        say: [["Jo", C.jo, "hey, can every estimate include a testing estimate?"], ["Sam", C.sam, "done ✓", { at: 0.72, right: true }]],
        parts: [[skillTake, "typing", "committed", 1.4]],
        crop: () => [{ t: 0, x: 440, y: 420, w: 745 }],
      },
      {
        time: "09:41", m: T(9, 41), rail: "The next estimate includes testing",
        say: [["Jira", C.jira, "DK-50 created: <b>Low-stock badge on product cards</b>", { icon: "jira" }]],
        parts: [["f-testing", "start", "done", 1.5], ["f-testing", "done", "poster", 1.2]],
        crop: (d, b) => [{ t: 0, ...ACT }, { t: b.at("run") + 1.4, ...ACT }, { t: b.at("run") + 2.1, ...RUNS }, { t: b.at("done") + 0.2, ...RUNS }, { t: b.at("done") + 1.2, ...PANE }],
      },
      {
        time: "10:02", m: T(10, 2), rail: "A run wants to delete a ticket; Jo says no",
        say: [["A clean-up run", C.run, "Can I delete DK-39? It looks like a duplicate.", { icon: "bot" }], ["Jo", C.jo, "No, keep it.", { at: 0.5, right: true }]],
        parts: [["c8-guard", "run", "poster", 1.3]],
        crop: (d, b) => [{ t: 0, ...CANVAS }, { t: b.at("asked") - 0.4, ...CANVAS }, { t: b.at("asked") + 0.4, ...REQ }, { t: b.at("denied") + 0.6, ...REQ }, { t: b.at("denied") + 1.4, ...CANVAS }],
        tail: 2,
      },
    ]);
    const duration = beats.at(-1).t1;
    const layers = [
      { kind: "text", html: '<span style="font-size:20px;font-weight:600;color:var(--muted-foreground)">acme · a day on the box</span>', x: 56, y: 58, fadeIn: 0 },
      { kind: "clock", x: 50, y: 92, size: 104, fadeIn: 0, keys: beats.flatMap((b, i) => [{ t: Math.max(0, b.t0 - 0.2), m: i ? beats[i - 1].m : b.m }, { t: b.t0 + 0.5, m: b.m }]) },
      { kind: "rail", x: 56, y: 252, w: 360, fadeIn: 0, rows: beats.map((b) => ({ t: b.t0, time: b.time, html: b.rail })) },
    ];
    beats.forEach((b, i) => {
      const d = b.t1 - b.t0;
      const crop = b.crop(d, b).map((k) => ({ ...k, t: b.t0 + k.t }));
      layers.push({ kind: "footage", t0: b.t0, t1: b.t1, frames: b.frames, rect: PANEL, crop, fadeIn: i ? 0.35 : 0, fadeOut: i === beats.length - 1 ? 0 : 0.35, z: 2 + (i % 2) });
      for (const [who, color, html, o = {}] of b.say) {
        const at = b.t0 + 0.15 + (o.at ? o.at * d : 0);
        layers.push(bubble(who, color, html, at, b.t1 - 0.15, PANEL.x, BY, { icon: o.icon, time: o.right ? "" : b.time, ...(o.right ? { rightEdge: PANEL.x + PANEL.w } : {}) }));
      }
    });
    return { duration, poster: beats[3].t0 + beats[3].lead + 1, layers };
  },

  "h1-push"(ctx) {
    const W = 1600, H = 1000;
    const laptop = 6.2;
    const push = ctx.seg("f-push", "start", "poster", 1.35);
    const merged = ctx.seg("c5-merged", "start", "poster", 1.2);
    const t1 = laptop + push.length / 30;
    const t2 = t1 - 0.3;
    const end = t2 + 1.2 + merged.length / 30 + 1.6;
    const PANEL = { x: 80, y: 60, w: 1440, h: 900 };
    return {
      duration: end,
      poster: t1 - 1.5,
      layers: [
        {
          kind: "term", x: 300, y: 250, w: 1000, h: 470, title: "sam@laptop: ~/acme-box", t0: 0, t1: laptop + 0.6, fadeIn: 0, fadeOut: 0.3,
          move: [{ t: laptop - 0.5, x: 0, s: 1 }, { t: laptop + 0.6, x: -1300, s: 0.92 }],
          script: [
            { t: 0.2, html: '<span class="d"># QA notes work on my laptop. Good enough for the team.</span>' },
            { t: 0.8, prompt: "~/acme-box $ ", type: "git add .claude/skills/qa-notes config.json", cps: 26 },
            { t: 2.8, prompt: "~/acme-box $ ", type: 'git commit -qm "QA notes on every merge"', cps: 26 },
            { t: 4.4, prompt: "~/acme-box $ ", type: "git push", cps: 16 },
            { t: 5.1, html: '<span class="d">To github.com:acme/acme-box.git\n   4f1c2e7..9b3d0a1  main -> main</span>' },
          ],
        },
        { kind: "footage", t0: laptop - 0.5, t1: t2 + 0.4, frames: push, rect: PANEL, crop: [{ t: 0, ...win(0, 0, 700) }, { t: laptop + 2.6, ...win(0, 0, 700) }, { t: laptop + 4.6, ...FULL }], move: [{ t: laptop - 0.5, x: 1500 }, { t: laptop + 0.6, x: 0 }], fadeIn: 0, z: 2 },
        { kind: "footage", t0: t2, t1: end, frames: [...Array(36).fill(merged[0]), ...merged], rect: PANEL, crop: [{ t: 0, x: 85, y: 0, w: 1100 }], z: 3 },
        bubble("GitHub", C.github, "acme/shop <b>#87 merged</b>", t2 + 0.2, end - 0.3, 120, 820, { icon: "github" }),
        { kind: "text", html: '<span class="chip">Sam pushed it. Now it runs for everyone.</span>', x: 120, y: 860, t0: laptop + 1.2, t1: t2, rise: true, z: 5 },
        { kind: "scrim", rect: { x: 0, y: 0, w: W, h: H }, radius: 0, color: "var(--background)", keys: [{ t: end - 1.6, a: 0 }, { t: end - 1.1, a: 0.92 }], t0: end - 1.6, t1: end, fadeIn: 0, fadeOut: 0, z: 8 },
        line("", end - 1.4, end, 0, 440, 84, { z: 9, fadeOut: 0.25, html: '<div style="width:1600px;text-align:center">Ship your product.<br>The box runs the chores.</div>' }),
      ],
    };
  },

  "h2-lids"(ctx) {
    const c = ctx.cam("f-lids");
    const parts = [
      ["start", "left-kai", 1.2],
      ["left-kai", "card", 2.4],
      ["card", "back-kai", 0.55],
      ["back-kai", "poster", 1.2],
    ];
    const frames = parts.flatMap(([a, b, s]) => ctx.seg("f-lids", a, b, s));
    // Piece time of a mark, given the speeds above.
    const tOf = (m) => {
      let t = 0;
      for (const [a, b, s] of parts) {
        if (c.at(m) <= c.at(b)) return t + (c.at(m) - c.at(a)) / s;
        t += (c.at(b) - c.at(a)) / s;
      }
      return t;
    };
    const duration = frames.length / 30 + 1.4;
    const night0 = tOf("left-kai") + 0.6, night1 = tOf("morning");
    const PANEL = { x: 80, y: 130, w: 1440, h: 850 };
    const gone = (m) => [[tOf(m), tOf("back-kai")]];
    return {
      duration,
      poster: tOf("card") + 0.5,
      layers: [
        { kind: "avatars", x: 84, y: 40, fadeIn: 0, people: [
          { name: "Alice", color: C.alice, away: [[night0 - 0.2, duration]] },
          { name: "Sam", color: C.sam, away: [[tOf("left-sam"), duration]] },
          { name: "Kai", color: C.kai, away: gone("left-kai") },
          { name: "Jo", color: C.jo, away: [[tOf("left-jo"), duration]] },
        ] },
        { kind: "clock", x: 1320, y: 24, size: 66, fadeIn: 0, keys: [{ t: 0, m: T(17, 40) }, { t: tOf("left-kai"), m: T(18, 25) }, { t: night0 + 1.4, m: T(2, 0) + 1440 }, { t: tOf("card"), m: T(2, 4) + 1440 }, { t: night1 - 0.4, m: T(2, 6) + 1440 }, { t: night1 + 0.8, m: T(9, 10) + 1440 }] },
        { kind: "footage", t0: 0, frames, rect: PANEL, crop: [{ t: 0, ...CANVAS }, { t: tOf("card") - 0.2, ...CANVAS }, { t: tOf("card") + 0.8, ...win(0, 0, 820) }, { t: tOf("approved") + 1.4, ...win(0, 0, 820) }, { t: tOf("approved") + 2.6, ...CANVAS }], fadeIn: 0, z: 2 },
        { kind: "scrim", rect: PANEL, color: "var(--night)", blend: "multiply", keys: [{ t: night0, a: 0 }, { t: night0 + 1.2, a: 0.42 }, { t: night1 - 0.3, a: 0.42 }, { t: night1 + 0.9, a: 0 }], t0: night0, t1: night1 + 1, z: 3, fadeIn: 0, fadeOut: 0 },
        { kind: "text", html: '<span class="chip">Everyone has gone home</span>', x: 120, y: 160, t0: night0 + 0.2, t1: tOf("nightly") + 0.6, rise: true, z: 5 },
        bubble("Schedule", C.clock, "nightly housekeeping", tOf("nightly") - 0.2, tOf("ticket"), 120, 820, { icon: "clock", time: "02:00" }),
        bubble("Jira", C.jira, "DK-51 created: <b>Gift cards at checkout</b>", tOf("ticket"), night1, 120, 820, { icon: "jira", time: "02:04" }),
        { kind: "text", html: '<span class="chip">The split waits in the Inbox</span>', x: 120, y: 160, t0: tOf("card") + 0.5, t1: night1 - 0.2, rise: true, z: 6 },
        bubble("Kai", C.kai, "Morning. <b>Approve.</b>", tOf("back-kai"), duration - 1.4, 120, 820, { time: "09:10" }),
        line("It keeps working when you've gone home.", duration - 1.5, duration, 0, 440, 76, { z: 9, html: '<div style="width:1600px;text-align:center">It keeps working when you’ve gone home.</div>' }),
        { kind: "scrim", rect: { x: 0, y: 0, w: 1600, h: 1000 }, radius: 0, color: "var(--background)", keys: [{ t: duration - 1.7, a: 0 }, { t: duration - 1.2, a: 0.92 }], t0: duration - 1.7, t1: duration, fadeIn: 0, fadeOut: 0, z: 8 },
      ],
    };
  },

  "h3-same"(ctx) {
    const names = ["alice", "sam", "kai", "jo"];
    const c = ctx.cam("f-same-alice");
    const tiles = names.map((n) => ctx.seg(`f-same-${n}`, "start", "poster", 1));
    const len = Math.min(...tiles.map((f) => f.length));
    const duration = len / 30 + 1.8;
    const at = (m) => c.at(m) - c.at("start");
    const W = 760, H = 475, X0 = 30, Y0 = 20, G = 20;
    const label = { alice: "Alice’s screen", sam: "Sam’s screen", kai: "Kai’s screen", jo: "Jo’s screen" };
    const events = [[at("moved") - 1.4, "Alice moves a window"], [at("typed") - 1.8, "Sam types in the shell"], [at("answered") - 0.2, "Kai answers the card"]];
    return {
      duration,
      poster: at("answered") + 0.8,
      layers: [
        ...names.map((n, i) => ({
          kind: "footage", t0: 0, frames: tiles[n === "alice" ? 0 : i].slice(0, len), rect: { x: X0 + (i % 2) * (W + G), y: Y0 + Math.floor(i / 2) * (H + G), w: W, h: H },
          crop: [{ t: 0, ...CANVAS }], fadeIn: 0, label: { name: n[0].toUpperCase() + n.slice(1), color: C[n], text: label[n] }, rings: events.map(([t]) => t + 0.9),
        })),
        ...events.map(([t, text], i) => ({ kind: "text", html: `<span class="chip">${text}, and all four see it</span>`, x: 560, y: 470, t0: t + 0.6, t1: (events[i + 1]?.[0] ?? duration - 1.6) + 0.5, rise: true, z: 6 })),
        { kind: "scrim", rect: { x: 0, y: 0, w: 1600, h: 1000 }, radius: 0, color: "var(--background)", keys: [{ t: duration - 1.7, a: 0 }, { t: duration - 1.2, a: 0.92 }], t0: duration - 1.7, t1: duration, fadeIn: 0, fadeOut: 0, z: 8 },
        line("One box. Everyone’s screen.", duration - 1.5, duration, 0, 440, 84, { z: 9, html: '<div style="width:1600px;text-align:center">One box. Everyone’s screen.</div>' }),
      ],
    };
  },

  "h4-zoom"(ctx) {
    const typed = ctx.seg("c14-by-hand", "start", "asked", 1);
    const rest = ctx.seg("c14-by-hand", "asked", "poster", 1.5);
    const frames = [...typed, ...rest];
    const tDoc = typed.length / 30 + 0.4;
    const tOut = frames.length / 30;
    const duration = tOut + 5.2;
    const PANEL = { x: 0, y: 0, w: 1600, h: 1000 };
    const tight = { x: 112, y: 700, w: 480 };
    const diagram = `
      <svg class="flow" width="1600" height="1000" viewBox="0 0 1600 1000" fill="none" stroke-width="4" stroke-linecap="round">
        <path d="M330 250 C 520 250, 560 420, 640 450" stroke="var(--muted-foreground)"/>
        <path d="M330 500 L 620 500" stroke="var(--muted-foreground)"/>
        <path d="M330 750 C 520 750, 560 580, 640 550" stroke="var(--muted-foreground)"/>
        <path d="M1270 500 L 960 500" stroke="var(--orange-fill)"/>
      </svg>
      <div style="position:absolute;left:150px;top:205px" class="chip">${'<span class="dot" style="background:#24292f">G</span>'}GitHub</div>
      <div style="position:absolute;left:150px;top:455px" class="chip"><span class="dot" style="background:#1868db">J</span>Jira</div>
      <div style="position:absolute;left:120px;top:705px" class="chip"><span class="dot" style="background:#5b6472">⏱</span>Every night</div>
      <div style="position:absolute;left:1280px;top:455px" class="chip"><span class="dot" style="background:${C.sam}">S</span>git push</div>
      <div style="position:absolute;left:640px;top:268px;width:320px;text-align:center;font-size:22px;font-weight:600;color:var(--muted-foreground)">acme · your team’s box</div>`;
    return {
      duration,
      poster: tOut - 0.5,
      layers: [
        { kind: "footage", t0: 0, frames: [...frames, ...Array(Math.round(5.2 * 30)).fill(frames.at(-1))], rect: PANEL, fadeIn: 0, fadeOut: 0, crop: [{ t: 0, ...tight }, { t: tDoc - 0.2, ...tight }, { t: tDoc + 1.8, ...FULL }], move: [{ t: tOut, s: 1, o: 1 }, { t: tOut + 1.4, s: 0.36, o: 1 }, { t: duration - 1.2, s: 0.36, o: 1 }, { t: duration - 0.2, s: 1, o: 0 }], origin: "50% 50%", z: 2 },
        { kind: "html", html: diagram, dash: 40, x: 0, y: 0, t0: tOut + 1, t1: duration - 1.1, z: 1 },
        line("A Linux box your agents can live in.", tOut + 1.5, duration - 1.1, 0, 820, 64, { z: 9, html: '<div style="width:1600px;text-align:center">A Linux box your agents can live in.</div>' }),
        { kind: "footage", t0: duration - 0.6, frames: [frames[0]], rect: PANEL, flat: true, crop: [{ t: 0, ...tight }], fadeIn: 0.5, fadeOut: 0, z: 3 },
      ],
    };
  },

  "h5-typed"(ctx) {
    const c = ctx.cam("f-typed");
    const parts = [
      ["start", "asked", 4],
      ["asked", "answered", 1],
      ["answered", c.at("answered") + 3, 1],
      ["hook", "finished", 1.2],
      ["finished", "poster", 1],
    ];
    const frames = parts.flatMap(([a, b, s]) => ctx.seg("f-typed", a, b, s));
    const tOf = (m) => {
      let t = 0;
      for (const [a, b, s] of parts) {
        if (c.at(m) >= c.at(a) && c.at(m) <= c.at(b)) return t + (c.at(m) - c.at(a)) / s;
        t += (c.at(b) - c.at(a)) / s;
      }
      return t;
    };
    const duration = frames.length / 30 + 1.8;
    const PANEL = { x: 80, y: 40, w: 1440, h: 900 };
    const typing = { x: 112, y: 690, w: 760 }, answer = { x: 104, y: 300, w: 900 }, code = { x: 1000, y: 258, w: 560 }, runs = win(740, 480, 440, 10);
    const tAns = tOf("answered");
    return {
      duration,
      poster: tOf("finished"),
      layers: [
        { kind: "footage", t0: 0, frames, rect: PANEL, fadeIn: 0, crop: [{ t: 0, ...typing }, { t: tOf("asked") - 0.2, ...typing }, { t: tOf("asked") + 0.8, ...code }, { t: tAns - 0.3, ...code }, { t: tAns + 0.5, ...answer }, { t: tAns + 2.6, ...answer }, { t: tAns + 3.2, ...runs }, { t: tOf("finished") + 0.6, ...runs }, { t: tOf("finished") + 1.6, ...CANVAS }], z: 2 },
        { kind: "text", html: '<span class="chip">Alice asks the box’s Claude</span>', x: 120, y: 860, t0: 0.3, t1: tOf("asked"), rise: true, z: 5 },
        { kind: "text", html: '<span class="chip">The skill, the workflow and the rule appear in the box’s files</span>', x: 120, y: 860, t0: tOf("asked") + 0.8, t1: tAns + 2.8, rise: true, z: 5 },
        bubble("GitHub", C.github, "acme/shop <b>#87 merged</b>", tAns + 3, tOf("finished") + 0.2, 120, 800, { icon: "github" }),
        bubble("Jira", C.jira, "QA notes added to <b>DK-43</b>", tOf("finished") + 0.2, duration - 1.6, 120, 800, { icon: "jira" }),
        { kind: "scrim", rect: { x: 0, y: 0, w: 1600, h: 1000 }, radius: 0, color: "var(--background)", keys: [{ t: duration - 1.7, a: 0 }, { t: duration - 1.2, a: 0.92 }], t0: duration - 1.7, t1: duration, fadeIn: 0, fadeOut: 0, z: 8 },
        line("Describe the chore. It’s running.", duration - 1.5, duration, 0, 440, 84, { z: 9, html: '<div style="width:1600px;text-align:center">Describe the chore. It’s running.</div>' }),
      ],
    };
  },

  "c15-canvas"(ctx) {
    // The landing pages' first picture, full width: gentle zooms follow the action, then pull back so
    // the whole board shows while Alice rearranges it. Other people's cursors are always on screen.
    const c = ctx.cam("c15-canvas");
    const parts = [
      ["start", "edit", 1.2],
      ["edit", "run", 1.25],
      ["run", "pr123", 1.2],
      ["pr123", "poster", 1.15],
    ];
    const frames = parts.flatMap(([a, b, sp]) => ctx.seg("c15-canvas", a, b, sp));
    const tOf = (m) => {
      let t = 0;
      for (const [a, b, sp] of parts) {
        if (c.at(m) >= c.at(a) && c.at(m) <= c.at(b)) return t + (c.at(m) - c.at(a)) / sp;
        t += (c.at(b) - c.at(a)) / sp;
      }
      return t;
    };
    const duration = frames.length / 30 + 0.8;
    const board = { x: 96, y: 20, w: 1504 };
    const term = { x: 96, y: 70, w: 1100 }, code = { x: 500, y: 70, w: 1100 }, runs = { x: 500, y: 313, w: 1100 };
    return {
      duration,
      poster: duration - 0.4,
      layers: [
        { kind: "footage", t0: 0, frames: [...frames, ...Array(24).fill(frames.at(-1))], rect: { x: 0, y: 0, w: 1600, h: 1000 }, flat: true, fadeIn: 0, fadeOut: 0,
          crop: [{ t: 0, ...board }, { t: tOf("edit") - 0.5, ...board }, { t: tOf("edit") + 0.5, ...code }, { t: tOf("saved") + 0.3, ...code }, { t: tOf("run") - 0.3, ...term }, { t: tOf("estimated") + 0.8, ...term }, { t: tOf("pr123") + 0.9, ...runs }, { t: tOf("arrange") - 0.1, ...runs }, { t: tOf("arrange") + 0.9, ...board }] },
      ],
    };
  },

  "h0-home"(ctx) {
    // h4 then h1, back to back: what the box is, then why it's different.
    const a = pieces["h4-zoom"](ctx);
    const b = pieces["h1-push"](ctx);
    const shift = (L, d) => {
      const s = (k) => k.map((x) => ({ ...x, t: x.t + d }));
      return { ...L, t0: (L.t0 ?? 0) + d, t1: L.t1 === undefined ? undefined : L.t1 + d, ...(L.crop ? { crop: s(L.crop) } : {}), ...(L.move ? { move: s(L.move) } : {}), ...(L.keys ? { keys: s(L.keys) } : {}), ...(L.script ? { script: s(L.script) } : {}), ...(L.rings ? { rings: L.rings.map((r) => r + d) } : {}), ...(L.people ? { people: L.people.map((p) => ({ ...p, away: (p.away ?? []).map(([x, y]) => [x + d, y + d]) })) } : {}) };
    };
    const d = a.duration - 0.6;
    const first = a.layers.map((L) => ({ ...L, t1: Math.min(L.t1 ?? a.duration, a.duration) }));
    return { duration: d + b.duration, poster: a.poster, layers: [...first, ...b.layers.map((L) => shift(L, d))] };
  },
};
